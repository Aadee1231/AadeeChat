from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from dotenv import load_dotenv
import os

load_dotenv()

print("OPENAI_API_KEY:", os.getenv("OPENAI_API_KEY"))

client = OpenAI()

FastAPIapp = FastAPI()

FastAPIapp.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@FastAPIapp.get("/")
def ping():
    return {"message": "pong"}

@FastAPIapp.post("/chat")
async def chat(request: Request):
    data = await request.json()
    user_message = data.get("message")
    print("User message:", user_message)

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": user_message},
        ]
    )

    reply = response.choices[0].message.content
    return {"response": reply}

import modal
app = modal.App("aadee-chat-backend")

image = modal.Image.debian_slim().pip_install_from_requirements("requirements.txt")

@app.function(image=image, secrets=[modal.Secret.from_name("openai-secrets")])
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def servefastapi_app():
    return FastAPIapp
