import asyncio
import grpc

from . import face_pb2, face_pb2_grpc
from .config import CFG
from .models import FaceModels
from .analysis import Landmarker
from .db import make_pool
from .pipeline import Frame, enroll


class FaceVerifier(face_pb2_grpc.FaceVerifierServicer):
    def __init__(self, models, landmarker, pool):
        self.models, self.landmarker, self.pool = models, landmarker, pool
        self.sem = asyncio.Semaphore(4)   # cap concurrent GPU work

    async def Enroll(self, request, context):
        challenge = face_pb2.Challenge.Name(request.challenge)
        frames = [Frame(f.data, face_pb2.Phase.Name(f.phase), f.client_ts_ms) for f in request.frames]
        async with self.sem:
            verdict, reason, sim, live = await enroll(
                self.models, self.landmarker, self.pool, CFG,
                request.user_id, request.session_id, challenge, frames,
                request.prompt_ts_ms, request.restarts,
            )
        return face_pb2.EnrollResponse(
            verdict=face_pb2.Verdict.Value(verdict),
            reason_code=reason, top_similarity=sim, liveness_score=live,
        )


async def serve():
    models = FaceModels(CFG)
    landmarker = Landmarker(CFG.landmarker_path)
    pool = await make_pool(CFG.database_url)

    server = grpc.aio.server(options=[
        ("grpc.max_receive_message_length", 10 * 1024 * 1024),
    ])
    face_pb2_grpc.add_FaceVerifierServicer_to_server(FaceVerifier(models, landmarker, pool), server)
    server.add_insecure_port(f"0.0.0.0:{CFG.grpc_port}")   # private network only; add mTLS in prod
    await server.start()
    await server.wait_for_termination()


if __name__ == "__main__":
    asyncio.run(serve())
