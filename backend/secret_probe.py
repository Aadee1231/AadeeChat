import os, modal
from fastapi import FastAPI

app = modal.App("secret-probe")
image = modal.Image.debian_slim().pip_install("fastapi[all]")

fast = FastAPI()

@fast.get("/")
def root():
    return {
        "OPENAI_API_KEY": bool(os.getenv("OPENAI_API_KEY")),
        "SUPABASE_URL": bool(os.getenv("SUPABASE_URL")),
        "SUPABASE_SERVICE_ROLE_KEY": bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
    }

@app.function(image=image, secrets=[modal.Secret.from_name("openai-secrets")])
@modal.asgi_app()
def serve():
    return fast
