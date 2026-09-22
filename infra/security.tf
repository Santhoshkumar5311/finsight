# Security foundation for an existing private service deployment.
# Provision compute separately; no cloud changes happen until terraform apply.
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}
variable "region" { type = string }
variable "audio_bucket_name" { type = string }
variable "vpc_id" { type = string }
variable "application_security_group_id" { type = string }
variable "load_balancer_arn" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "database_password" {
  type = string
  sensitive = true
}
provider "aws" { region = var.region }
resource "aws_kms_key" "financial_data" {
  description = "FinSight encrypted financial storage"
  enable_key_rotation = true
  rotation_period_in_days = 90
  deletion_window_in_days = 30
}
resource "aws_s3_bucket" "audio" { bucket = var.audio_bucket_name }
resource "aws_s3_bucket_public_access_block" "audio" {
  bucket = aws_s3_bucket.audio.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
      kms_master_key_id = aws_kms_key.financial_data.arn
    }
    bucket_key_enabled = true
  }
}
resource "aws_s3_bucket_versioning" "audio" {
  bucket = aws_s3_bucket.audio.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_policy" "audio" {
  bucket = aws_s3_bucket.audio.id
  policy = jsonencode({Version="2012-10-17",Statement=[
    {Sid="DenyInsecureTransport",Effect="Deny",Principal="*",Action="s3:*",Resource=[aws_s3_bucket.audio.arn,"${aws_s3_bucket.audio.arn}/*"],Condition={Bool={"aws:SecureTransport"="false"}}},
    {Sid="RequireKMSWrites",Effect="Deny",Principal="*",Action="s3:PutObject",Resource="${aws_s3_bucket.audio.arn}/*",Condition={StringNotEquals={"s3:x-amz-server-side-encryption"="aws:kms"}}},
    {Sid="RequireDesignatedKey",Effect="Deny",Principal="*",Action="s3:PutObject",Resource="${aws_s3_bucket.audio.arn}/*",Condition={StringNotEquals={"s3:x-amz-server-side-encryption-aws-kms-key-id"=aws_kms_key.financial_data.arn}}}
  ]})
}
resource "aws_security_group" "database" {
  name_prefix = "finsight-database-"
  description = "PostgreSQL only from FinSight service identity"
  vpc_id = var.vpc_id
}
resource "aws_vpc_security_group_ingress_rule" "database" {
  security_group_id = aws_security_group.database.id
  referenced_security_group_id = var.application_security_group_id
  ip_protocol = "tcp"
  from_port = 5432
  to_port = 5432
}
resource "aws_db_subnet_group" "database" { subnet_ids = var.private_subnet_ids }
resource "aws_db_instance" "database" {
  identifier_prefix = "finsight-"
  engine = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.small"
  allocated_storage = 25
  max_allocated_storage = 100
  db_name = "finsight"
  username = "finsight_migrator"
  password = var.database_password
  storage_encrypted = true
  kms_key_id = aws_kms_key.financial_data.arn
  publicly_accessible = false
  db_subnet_group_name = aws_db_subnet_group.database.name
  vpc_security_group_ids = [aws_security_group.database.id]
  backup_retention_period = 14
  deletion_protection = true
  skip_final_snapshot = false
  final_snapshot_identifier = "finsight-final-snapshot"
  enabled_cloudwatch_logs_exports = ["postgresql"]
}
resource "aws_wafv2_web_acl" "edge" {
  name = "finsight-edge"
  scope = "REGIONAL"
  default_action { allow {} }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name = "finsight-waf"
    sampled_requests_enabled = false
  }
  rule {
    name = "common-exploits"
    priority = 1
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name = "finsight-exploits"
      sampled_requests_enabled = false
    }
  }
  rule {
    name = "ip-rate-limit"
    priority = 2
    action { block {} }
    statement {
      rate_based_statement {
        limit = 2000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name = "finsight-rate"
      sampled_requests_enabled = false
    }
  }
}
resource "aws_wafv2_web_acl_association" "edge" {
  resource_arn = var.load_balancer_arn
  web_acl_arn = aws_wafv2_web_acl.edge.arn
}
output "audio_bucket" { value = aws_s3_bucket.audio.id }
output "kms_key_arn" { value = aws_kms_key.financial_data.arn }
output "private_database_endpoint" { value = aws_db_instance.database.address }

variable "audit_bucket_name" { type = string }
resource "aws_s3_bucket" "audit" {
  bucket = var.audit_bucket_name
  object_lock_enabled = true
}
resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  depends_on = [aws_s3_bucket_versioning.audit]
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = 90
    }
  }
}
resource "aws_s3_bucket_public_access_block" "audit" {
  bucket = aws_s3_bucket.audit.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
      kms_master_key_id = aws_kms_key.financial_data.arn
    }
    bucket_key_enabled = true
  }
}
resource "aws_s3_bucket_policy" "audit" {
  bucket = aws_s3_bucket.audit.id
  policy = jsonencode({Version="2012-10-17",Statement=[
    {Sid="DenyInsecureTransport",Effect="Deny",Principal="*",Action="s3:*",Resource=[aws_s3_bucket.audit.arn,"${aws_s3_bucket.audit.arn}/*"],Condition={Bool={"aws:SecureTransport"="false"}}},
    {Sid="RequireKMSWrites",Effect="Deny",Principal="*",Action="s3:PutObject",Resource="${aws_s3_bucket.audit.arn}/*",Condition={StringNotEquals={"s3:x-amz-server-side-encryption"="aws:kms"}}},
    {Sid="RequireDesignatedKey",Effect="Deny",Principal="*",Action="s3:PutObject",Resource="${aws_s3_bucket.audit.arn}/*",Condition={StringNotEquals={"s3:x-amz-server-side-encryption-aws-kms-key-id"=aws_kms_key.financial_data.arn}}}
  ]})
}
output "audit_bucket" { value = aws_s3_bucket.audit.id }
