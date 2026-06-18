import boto3
import json
import logging
from botocore.exceptions import ClientError, NoCredentialsError

# --- CONFIGURATION ---
# Replace with fresh keys when you have them
CREDENTIALS = {
    "accessKeyId": "ASI...", 
    "secretAccessKey": "",
    "sessionToken": "",
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