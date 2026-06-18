import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import boto3
from botocore.exceptions import ClientError
import os
from datetime import datetime
from typing import Any

app = FastAPI(title="AWS Permission Assessor")

os.makedirs("static", exist_ok=True)

class Credentials(BaseModel):
    access_key: str
    secret_key: str
    session_token: str = ""
    region: str = "us-east-1"

class ExecuteRequest(BaseModel):
    access_key: str
    secret_key: str
    session_token: str = ""
    region: str = "us-east-1"
    service: str
    action: str
    params_json: str = "{}"

class TestResult(BaseModel):
    service: str
    action: str
    status: str
    message: str
    data: Any = None
    next_steps: list[str] = []
    explanation: str = ""

def make_serializable(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    elif isinstance(obj, dict):
        return {k: make_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [make_serializable(i) for i in obj]
    return obj

TESTS = [
    {"service": "sts", "action": "GetCallerIdentity", "boto_client": "sts", "boto_method": "get_caller_identity", "kwargs": {}, "next_steps": ["iam:ListAttachedUserPolicies", "iam:GetUser"], "explanation": "Returns details about the IAM user or role whose credentials are used to call the operation. Useful for confirming who you are authenticated as."},
    {"service": "s3", "action": "ListAllMyBuckets", "boto_client": "s3", "boto_method": "list_buckets", "kwargs": {}, "next_steps": ["s3:GetObject", "s3:GetBucketAcl", "s3:ListObjectsV2"], "explanation": "Lists all S3 buckets owned by the authenticated sender of the request."},
    {"service": "ec2", "action": "DescribeInstances", "boto_client": "ec2", "boto_method": "describe_instances", "kwargs": {"MaxResults": 5}, "next_steps": ["ec2:DescribeVolumes", "ec2:DescribeSecurityGroups"], "explanation": "Describes your EC2 instances. If allowed, you can see what compute resources are running in the current region."},
    {"service": "iam", "action": "ListUsers", "boto_client": "iam", "boto_method": "list_users", "kwargs": {"MaxItems": 5}, "next_steps": ["iam:ListAccessKeys", "iam:CreateUser"], "explanation": "Lists the IAM users in the account. High-value target for lateral movement."},
    {"service": "lambda", "action": "ListFunctions", "boto_client": "lambda", "boto_method": "list_functions", "kwargs": {"MaxItems": 5}, "next_steps": ["lambda:GetFunction", "lambda:InvokeFunction"], "explanation": "Lists Lambda functions. These often contain source code with hardcoded secrets or overly permissive execution roles."},
    {"service": "dynamodb", "action": "ListTables", "boto_client": "dynamodb", "boto_method": "list_tables", "kwargs": {"Limit": 5}, "next_steps": ["dynamodb:Scan", "dynamodb:DescribeTable"], "explanation": "Lists DynamoDB tables. Tables might contain sensitive user or application data."},
    {"service": "rds", "action": "DescribeDBInstances", "boto_client": "rds", "boto_method": "describe_db_instances", "kwargs": {"MaxRecords": 20}, "next_steps": ["rds:DescribeDBSnapshots"], "explanation": "Describes RDS database instances. Helps map out the data tier of the environment."},
    {"service": "cloudformation", "action": "DescribeStacks", "boto_client": "cloudformation", "boto_method": "describe_stacks", "kwargs": {}, "next_steps": ["cloudformation:GetTemplate", "cloudformation:DescribeStackResources"], "explanation": "Lists CloudFormation stacks. Templates can reveal infrastructure details and sometimes embedded secrets."},
    {"service": "sns", "action": "ListTopics", "boto_client": "sns", "boto_method": "list_topics", "kwargs": {}, "next_steps": ["sns:GetTopicAttributes"], "explanation": "Lists SNS topics. Can be used to intercept messages if allowed to subscribe."},
    {"service": "sqs", "action": "ListQueues", "boto_client": "sqs", "boto_method": "list_queues", "kwargs": {"MaxResults": 5}, "next_steps": ["sqs:ReceiveMessage", "sqs:GetQueueAttributes"], "explanation": "Lists SQS queues. Queues often contain sensitive application messages."},
    {"service": "secretsmanager", "action": "ListSecrets", "boto_client": "secretsmanager", "boto_method": "list_secrets", "kwargs": {"MaxResults": 5}, "next_steps": ["secretsmanager:GetSecretValue"], "explanation": "Lists secrets in Secrets Manager. Extremely high-value target for privilege escalation."},
    {"service": "kms", "action": "ListAliases", "boto_client": "kms", "boto_method": "list_aliases", "kwargs": {"Limit": 5}, "next_steps": ["kms:DescribeKey"], "explanation": "Lists KMS key aliases. Used for encryption/decryption operations."},
    {"service": "ecs", "action": "ListClusters", "boto_client": "ecs", "boto_method": "list_clusters", "kwargs": {"maxResults": 5}, "next_steps": ["ecs:DescribeClusters", "ecs:ListTasks"], "explanation": "Lists ECS clusters. Useful for understanding containerized workloads running in the account."},
]

@app.get("/api/health")
def health_check():
    return {"status": "ok"}

@app.post("/api/test", response_model=list[TestResult])
def run_tests(creds: Credentials):
    results = []
    
    for test in TESTS:
        try:
            client_args = {
                "aws_access_key_id": creds.access_key,
                "aws_secret_access_key": creds.secret_key,
                "region_name": creds.region
            }
            if creds.session_token:
                client_args["aws_session_token"] = creds.session_token
                
            client = boto3.client(test["boto_client"], **client_args)
            method = getattr(client, test["boto_method"])
            response = method(**test["kwargs"])
            
            if 'ResponseMetadata' in response:
                del response['ResponseMetadata']
            
            clean_data = make_serializable(response)
            
            results.append(TestResult(
                service=test["service"],
                action=test["action"],
                status="Allowed",
                message="Success",
                data=clean_data,
                next_steps=test["next_steps"],
                explanation=test["explanation"]
            ))
            
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            if 'AccessDenied' in error_code or 'Unauthorized' in error_code or error_code == 'AuthFailure':
                results.append(TestResult(
                    service=test["service"],
                    action=test["action"],
                    status="Denied",
                    message=str(e),
                    data=None,
                    explanation=test["explanation"]
                ))
            else:
                results.append(TestResult(
                    service=test["service"],
                    action=test["action"],
                    status="Error",
                    message=str(e),
                    data=None,
                    explanation=test["explanation"]
                ))
        except Exception as e:
             results.append(TestResult(
                service=test["service"],
                action=test["action"],
                status="Error",
                message=str(e),
                data=None,
                explanation=test["explanation"]
            ))
            
    return results

import json

@app.post("/api/execute")
def execute_action(req: ExecuteRequest):
    try:
        client_args = {
            "aws_access_key_id": req.access_key,
            "aws_secret_access_key": req.secret_key,
            "region_name": req.region
        }
        if req.session_token:
            client_args["aws_session_token"] = req.session_token
            
        # Parse params from json
        try:
            params = json.loads(req.params_json)
        except json.JSONDecodeError:
            return {"status": "Error", "message": "Invalid JSON in parameters"}

        # Attempt to map the AWS service action string (e.g., iam:ListAttachedUserPolicies) 
        # to a boto3 client and method (e.g., client('iam').list_attached_user_policies())
        parts = req.action.split(':')
        if len(parts) == 2:
            service = parts[0].lower()
            action_name = parts[1]
        else:
            service = req.service.lower()
            action_name = req.action
            
        # Convert camelCase/PascalCase to snake_case for boto3
        import re
        boto_method = re.sub(r'(?<!^)(?=[A-Z])', '_', action_name).lower()
        
        client = boto3.client(service, **client_args)
        if not hasattr(client, boto_method):
            return {"status": "Error", "message": f"Method {boto_method} not found on client {service}"}
            
        method = getattr(client, boto_method)
        response = method(**params)
        
        if 'ResponseMetadata' in response:
            del response['ResponseMetadata']
            
        return {
            "status": "Allowed",
            "message": "Success",
            "data": make_serializable(response)
        }
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        status = "Denied" if 'AccessDenied' in error_code or 'Unauthorized' in error_code or error_code == 'AuthFailure' else "Error"
        return {"status": status, "message": str(e), "data": None}
    except Exception as e:
        return {"status": "Error", "message": str(e), "data": None}

app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
