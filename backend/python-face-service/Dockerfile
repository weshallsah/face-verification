FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
RUN apt-get update && apt-get install -y python3.11 python3-pip libgl1 libglib2.0-0 libegl1 libgles2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/python-face-service/requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt
COPY backend/python-face-service/app ./app
COPY proto ./proto
RUN python3 -m grpc_tools.protoc -I proto --python_out=app --grpc_python_out=app proto/face.proto \
    && sed -i 's/^import face_pb2 as/from . import face_pb2 as/' app/face_pb2_grpc.py
CMD ["python3", "-m", "app.main"]
