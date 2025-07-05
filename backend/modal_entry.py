from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import modal

app = modal.App("aadee-chat-backend")

image = modal.Image.debian_slim().pip_install("fastapi[standard]")

fastapi_app = FastAPI()

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@fastapi_app.get("/ping")
def ping():
    return {"message": "pong from modal"}

@app.function(image=image)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def servefastapi_app():
    return fastapi_app
