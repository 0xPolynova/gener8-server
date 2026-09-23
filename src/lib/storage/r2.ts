import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/config/env";

export function r2Configured() {
  return Boolean(
    env.r2AccountId &&
      env.r2AccessKeyId &&
      env.r2SecretAccessKey &&
      env.r2Bucket &&
      env.r2PublicUrl,
  );
}

let client: S3Client | null = null;

function r2() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.r2AccessKeyId,
        secretAccessKey: env.r2SecretAccessKey,
      },
    });
  }
  return client;
}

export async function uploadR2(key: string, body: Buffer, contentType: string) {
  const objectKey = key.replace(/^\/+/, "");
  await r2().send(
    new PutObjectCommand({
      Bucket: env.r2Bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    }),
  );
  return `${env.r2PublicUrl.replace(/\/$/, "")}/${objectKey}`;
}
