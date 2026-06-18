import boto3
import json
import logging
from botocore.exceptions import ClientError, NoCredentialsError

# --- CONFIGURATION ---
# Replace with fresh keys when you have them
CREDENTIALS = {
    "accessKeyId": "ASIASDAG6UDKEIIQKICD", 
    "secretAccessKey": "fkLTkCpiNVdkTODmvk+V+BqgOhrgXS2a32YJ1myF",
    "sessionToken": "AJId+Oq51zNTUdG/iaNkwOcoEb7ubsqtwUI+///////////ARAAGgwxNDM4OTU5OTQ1ODAiDFdvzRw4sSaotP4gCSqLBfTF9vE8bZfp26lJjMHEO6cZSaojNLrbuVBEtLJ+neCqRLtxQJQWCmtHKt3zbv8QOfoEq8/75jZp5/3NTb19n9zfR8S0+TItMTTlnXQBOxh9uv5VUCE3gSznJ2uzsE3IPgcbSmnF0FUujSGfIqNNpmQk6V8nTVIZxXizhVs2dRgyZmnGyZ7UCythypDlioqvfQ+ZX4mcLy2MdFig+UQ1EQ2AOUdDmTd8QiV5w9pGW6FJs5dzmC7qpC3XxuLLG6kAwzTcOtdDH7rSxM64qOk0BclCCIHEE3TQoZBu2LOfcFDnB4mbRugS2j7WI/wkX4GEyOqhcy7YY8hpFZuxLbPPeDvLDNQyZEIvutpxXDcpYLeI2qRH1JckiKiYR2F3xv4yqe5QNT85O0U1l/wxCV4+I/rFEacP1fr1qJ/Tgfn2krTmE13VT2g7qWhYY31ghXmM75gEENQV38q9U7N/Ly8v+AH80rSAY2i/z8SLdHHhgTYUV32TsCNtQjjrgpmttWXhDeBiRNYtcLx+tK77efHgJ2yzPw9MJJ3odPDmfxXHcIzQ5zsKJPaiFP4X5OtglYIrl42YAfu5lvVp+EYuiy379wWolxsa1W96fzlm4pbhIf6zpM/uc4ymAtdEaJfsZE3b0F2WeEfw8nKfH9f92eORc3yJDiu8Uyno39tcSvU0vtoDOgmucGqtbBGdi8yvnppuyVQALDmu7rk4KNDij0rqGoBSLlEy1GXm+2O2lxfHwMkIKoa9aW+VfA9NoXR2M2w80dUJ5qX24ZTdBKBjl2qDn2FAoLsWDxtL5tYIYSJVAUiirSpJWmEnkBnw1pXLYDjSMhUzD4IbxWIJwyOWrYXg/kLwBCchxgqP3tc5FDCcp4HQBjreAjSW2tpwcgXu5T+DHix6fHlbtAkNiA6Pm3f/b0/pDmnX+v/+OWkRWBU9e9oAAAKNrUB0tKj1eVB3V8KO9Z9t2MdF+Cb8/0gKhivySV1isvbQD9urJhuuwMpq5My77Vb/gYEocD8ZXGKTVJZ/vbva25FP1anwOALmDdkItMqxf6OXowjM/b+3xpulVQysi8yGRK+BCVuTyO8Ld+z9lXk7N2uKIuG0tq8A+JvMIEFX/xDpmxbHGgoGw6p37GBzI2zofaQPvRjlFJ8Rxidb6n0bp2FndmPXGX8vvxLsE1eQ0cqm0FfetmdeKE0M8D3KkRlPoyqpJzTiTGsDTek5DwqSNpm2VkVAV1dmHfF5JT1wFhgiryzFU3amzfhONfv+8LGSNNt+CBPn1YyzsJUolWgOpgrbrpiA1O0nE2MFH+Kk5Xl17eOPqlKTrwGZMa+z16VdZpktX7jgCecrONxFgIBM",
    "region": "eu-west-1" 
}


def get_session():
    try:
        return boto3.Session(
            aws_access_key_id=CREDENTIALS['accessKeyId'],
            aws_secret_access_key=CREDENTIALS['secretAccessKey'],
            aws_session_token=CREDENTIALS['sessionToken'],
            region_name=CREDENTIALS['region']
        )
    except Exception as e:
        logging.error(f"Failed to initialize session: {e}")
        return None

def investigate():
    session = get_session()
    if not session: return

    # List of checks: (Service, Method, Description)
    checks = [
        ('sts', 'get_caller_identity', 'Who Am I?'),
        ('iam', 'list_users', 'User Enumeration'),
        ('iam', 'list_roles', 'Role Enumeration'),
        ('s3', 'list_buckets', 'Storage Discovery'),
        ('ec2', 'describe_instances', 'Compute Discovery'),
        ('ec2', 'describe_security_groups', 'Network Rules'),
        ('lambda', 'list_functions', 'Serverless Discovery'),
        ('dynamodb', 'list_tables', 'Database Discovery'),
        ('rds', 'describe_db_instances', 'Relational DB Discovery'),
        ('secretsmanager', 'list_secrets', 'Secret Names Discovery'),
        ('rum', 'list_app_monitors', 'RUM Specific Check'),
        ('cloudtrail', 'describe_trails', 'Logging Check')
    ]

    results = {}

    for service_name, method_name, description in checks:
        print(f"Checking: {description} ({service_name}.{method_name})")
        try:
            client = session.client(service_name)
            method = getattr(client, method_name)
            response = method()
            
            # Clean response for logging (remove metadata)
            if 'ResponseMetadata' in response: del response['ResponseMetadata']
            
            results[description] = {"status": "SUCCESS", "data": response}
            print(f"✅ {description}: ACCESS GRANTED")
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            results[description] = {"status": "DENIED", "error": error_code}
            print(f"❌ {description}: {error_code}")
            
        except Exception as e:
            results[description] = {"status": "ERROR", "error": str(e)}
            print(f"⚠️ {description}: System Error - {str(e)[:50]}")

    # Write full JSON report to file
    with open("full_report.json", "w", encoding='utf-8', errors='ignore') as f:
        json.dump(results, f, indent=4, default=str)


if __name__ == "__main__":
    investigate()