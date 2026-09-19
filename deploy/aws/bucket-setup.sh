#!/usr/bin/env bash
#
# bucket-setup.sh — create and lock down the S3 bucket.
#
# Run once, from your own machine, with admin credentials:
#
#     BUCKET=ucf-mom-files REGION=ap-south-2 ./bucket-setup.sh
#
# What it sets, and why each one is here rather than left at the default:
#
#   * block all public access — documents in this bucket are sanction orders
#     and signed minutes; not one of them should ever be world-readable, and
#     this makes it impossible rather than merely unintended;
#   * default encryption at rest;
#   * versioning — the cheapest possible protection against "someone deleted
#     the wrong thing", including this application deleting the wrong thing;
#   * TLS-only access, enforced by the bucket policy rather than by hoping;
#   * lifecycle rules — backups expire after a year, old versions after 90
#     days, and incomplete multipart uploads after 7 so they stop being billed.

set -Eeuo pipefail

BUCKET="${BUCKET:?set BUCKET, e.g. BUCKET=ucf-mom-files}"
REGION="${REGION:-ap-south-2}"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  log "s3://$BUCKET already exists — applying settings to it"
else
  log "Creating s3://$BUCKET in $REGION"
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION"
fi

log "Blocking all public access"
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'

log "Turning on default encryption"
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": { "SSEAlgorithm": "AES256" },
      "BucketKeyEnabled": true
    }]
  }'

log "Turning on versioning"
aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

log "Requiring TLS"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$(cat <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyUnencryptedTransport",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": ["arn:aws:s3:::$BUCKET", "arn:aws:s3:::$BUCKET/*"],
    "Condition": { "Bool": { "aws:SecureTransport": "false" } }
  }]
}
POLICY
)"

log "Setting the lifecycle rules"
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "expire-backups-after-a-year",
        "Status": "Enabled",
        "Filter": { "Prefix": "backups/" },
        "Transitions": [{ "Days": 30, "StorageClass": "STANDARD_IA" }],
        "Expiration": { "Days": 365 }
      },
      {
        "ID": "expire-old-versions",
        "Status": "Enabled",
        "Filter": { "Prefix": "" },
        "NoncurrentVersionExpiration": { "NoncurrentDays": 90 }
      },
      {
        "ID": "abandon-incomplete-uploads",
        "Status": "Enabled",
        "Filter": { "Prefix": "" },
        "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
      }
    ]
  }'

cat <<DONE

  s3://$BUCKET is ready.

  Put it in /etc/mom/mom.env on the server:
    S3_BUCKET=$BUCKET
    S3_REGION=$REGION
    S3_PREFIX=files
    BACKUP_S3_URI=s3://$BUCKET/backups

  Then attach deploy/aws/instance-role-policy.json (with the bucket name
  substituted) to the instance role.

DONE
