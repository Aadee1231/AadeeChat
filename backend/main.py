# main.py
import os
from typing import Any, Dict, List, Optional, Literal, cast
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

from supabase import create_client, Client

# Optional: Modal deploy
import modal

# =========================
# Env & clients
# =========================
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not OPENAI_API_KEY:
    raise RuntimeError("Missing OPENAI_API_KEY")
if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

# OpenAI
client = OpenAI(api_key=OPENAI_API_KEY)

# Supabase
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# =========================
# FastAPI app
# =========================
FastAPIapp = FastAPI(title="Aadee Chat Backend")

FastAPIapp.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# Types
# =========================
Role = Literal["system", "user", "assistant"]

# =========================
# DB helpers
# =========================
def _get_chat_or_404(chat_id: str) -> Dict[str, Any]:
    res = supabase.table("chats").select("*").eq("id", chat_id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Chat not found")
    return cast(Dict[str, Any], res.data[0])

def _list_messages(chat_id: str, limit: int = 200) -> List[Dict[str, Any]]:
    res = (
        supabase.table("messages")
        .select("*")
        .eq("chat_id", chat_id)
        .order("created_at", desc=False)
        .limit(limit)
        .execute()
    )
    data = res.data or []
    return cast(List[Dict[str, Any]], list(data))

def _insert_message(chat_id: str, role: Role, content: str) -> None:
    supabase.table("messages").insert({
        "chat_id": chat_id,
        "role": role,
        "content": content or ""
    }).execute()

def _maybe_set_title_from_first_user(chat_id: str) -> None:
    chat_res = supabase.table("chats").select("id,title").eq("id", chat_id).limit(1).execute()
    chat = cast(Dict[str, Any], chat_res.data[0])
    if chat["title"] != "New Chat":
        return
    msgs = _list_messages(chat_id, limit=10)
    first_user = next((m for m in msgs if m.get("role") == "user"), None)
    if not first_user:
        return
    title_src = str(first_user.get("content") or "").strip().replace("\n", " ")
    title = (title_src[:40] + "…") if len(title_src) > 40 else (title_src or "New Chat")
    supabase.table("chats").update({"title": title}).eq("id", chat_id).execute()

# =========================
# Routes
# =========================
@FastAPIapp.get("/")
def ping():
    return {"message": "pong"}

# --- One-off chat (kept for convenience)
@FastAPIapp.post("/chat")
async def chat(request: Request):
    data = await request.json()
    user_message = (data.get("message") or "").strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    completion = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            cast(ChatCompletionMessageParam, {"role": "system", "content": "You are a helpful assistant."}),
            cast(ChatCompletionMessageParam, {"role": "user", "content": user_message}),
        ]
    )
    reply = completion.choices[0].message.content or ""
    return {"response": reply}

@FastAPIapp.post("/chats")
async def create_chat(request: Request):
    data = await request.json()
    title: str = (data.get("title") or "New Chat").strip() or "New Chat"

    # Brand persona (system) + a separate greeting (assistant)
    persona = (
        "You are AadeeChat, an AI assistant created by Aadee Inc. "
        "When asked about your identity or creator, say you are AadeeChat by Aadee Inc. "
        "Be concise, professional, and friendly."
    )
    greeting = (data.get("greeting") or "Hello! How can I assist you today?").strip()

    # allow optional override of persona from client, else use ours
    system_prompt: str = (data.get("system_prompt") or persona).strip()

    # create chat
    chat_res = supabase.table("chats").insert({"title": title}).execute()
    if not chat_res.data:
        raise HTTPException(status_code=500, detail="Failed to create chat")
    chat = cast(Dict[str, Any], chat_res.data[0])

    # 1) store persona as hidden context (system)
    _insert_message(chat["id"], "system", system_prompt)
    # 2) store a visible greeting (assistant bubble)
    _insert_message(chat["id"], "assistant", greeting)

    return {
        "id": chat["id"],
        "title": chat.get("title", "New Chat"),
        "created_at": chat.get("created_at"),
        "updated_at": chat.get("updated_at"),
    }


# --- Delete chats
@FastAPIapp.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str):
    _get_chat_or_404(chat_id)
    supabase.table("chats").delete().eq("id", chat_id).execute()
    return {"message": f"Chat {chat_id} deleted successfully"}


# --- List chats (newest first)
@FastAPIapp.get("/chats")
async def list_chats():
    res = (
        supabase.table("chats")
        .select("id,title,created_at,updated_at")
        .order("updated_at", desc=True)
        .execute()
    )
    return res.data or []

# --- Get messages for a chat
@FastAPIapp.get("/chats/{chat_id}/messages")
async def get_messages(chat_id: str):
    _get_chat_or_404(chat_id)
    msgs = _list_messages(chat_id, limit=200)
    return msgs

# --- Send a message with full context
@FastAPIapp.post("/chats/{chat_id}/messages")
async def send_message(chat_id: str, request: Request):
    _get_chat_or_404(chat_id)

    data = await request.json()
    user_message = (data.get("message") or "").strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    # 1) store user message
    _insert_message(chat_id, "user", user_message)

    # 2) fetch history and coerce to typed messages for OpenAI
    history = _list_messages(chat_id, limit=200)

    typed_messages: List[ChatCompletionMessageParam] = []
    for m in history:
        role = str(m.get("role") or "user")
        content = str(m.get("content") or "")
        typed_messages.append(cast(ChatCompletionMessageParam, {"role": role, "content": content}))

    # 3) OpenAI with full history
    completion = client.chat.completions.create(
        model="gpt-4o",
        messages=typed_messages
    )
    assistant_reply: str = completion.choices[0].message.content or ""

    # 4) store assistant reply
    _insert_message(chat_id, "assistant", assistant_reply)

    # 5) maybe auto-rename chat
    _maybe_set_title_from_first_user(chat_id)

    return {"response": assistant_reply, "chat_id": chat_id}

# =========================
# Modal deployment (optional)
# Make sure the secret contains:
# OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
# =========================
app = modal.App("aadee-chat-backend")
image = modal.Image.debian_slim().pip_install_from_requirements("requirements.txt")

@app.function(image=image, secrets=[modal.Secret.from_name("openai-secrets")])
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def servefastapi_app(): 
    return FastAPIapp
