import path from 'node:path';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const def = protoLoader.loadSync(path.resolve('proto/face.proto'), {
  keepCase: false,   // fields become camelCase: userId, sessionId ...
  enums: String,     // enums as 'LOOK_LEFT', 'ACCEPTED' ...
  defaults: true,
});
const pkg = grpc.loadPackageDefinition(def).faceverify.v1;

const client = new pkg.FaceVerifier(
  process.env.FACE_GRPC_ADDR ?? 'face-service:50051',
  grpc.credentials.createInsecure(),          // private network; use mTLS in production
  { 'grpc.max_send_message_length': 10 * 1024 * 1024 },
);

export function enroll(req, timeoutMs = Number(process.env.FACE_GRPC_TIMEOUT_MS ?? 15000)) {
  return new Promise((resolve, reject) => {
    client.Enroll(req, { deadline: Date.now() + timeoutMs }, (err, res) =>
      err ? reject(err) : resolve(res),
    );
  });
}
