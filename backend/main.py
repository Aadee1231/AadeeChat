# main.py
import os
from typing import Any, Dict, List, Literal, cast
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from openai import OpenAI
from supabase import create_client, Client
import modal
import httpx

load_dotenv()

# --- Env
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not OPENAI_API_KEY:
    raise RuntimeError("Missing OPENAI_API_KEY")
if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

# Coerce to str so type-checkers are happy for headers/URLs
SUPABASE_URL = cast(str, SUPABASE_URL)
SUPABASE_SERVICE_ROLE_KEY = cast(str, SUPABASE_SERVICE_ROLE_KEY)

# --- Clients
client = OpenAI()  # uses OPENAI_API_KEY
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# --- FastAPI
FastAPIapp = FastAPI()
FastAPIapp.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later if you want
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Role = Literal["system", "user", "assistant"]

# ========= Auth helper (verify Supabase JWT) =========
async def get_current_user(request: Request) -> Dict[str, Any]:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token: str = auth_header.split(" ", 1)[1]  # explicitly str

    # Force a non-Optional str for type checker
    apikey: str = cast(str, SUPABASE_SERVICE_ROLE_KEY)

    headers: Dict[str, str] = {
        "Authorization": f"Bearer {token}",
        "apikey": apikey,
    }

    async with httpx.AsyncClient(timeout=10) as x:
        r = await x.get(f"{SUPABASE_URL}/auth/v1/user", headers=headers)
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid auth token")
    return r.json()

# ========= DB helpers =========

def _get_chat_or_404_owned(chat_id: str, user_id: str) -> Dict[str, Any]:
    res = (
        supabase.table("chats")
        .select("*")
        .eq("id", chat_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
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

# ========= Responses API helpers =========

DEFAULT_PERSONA = (
    "You are AadeeChat, built by Aadee Inc. Be concrete, practical, and friendly. "
    "Skip canned disclaimers. Use step-by-step plans and small code blocks when helpful. "
    "If you used web search, include short inline source links."
)

def _extract_persona_from_history(history: List[Dict[str, Any]]) -> str:
    """Use the first system message as 'instructions' if present, else fallback."""
    for m in history:
        if m.get("role") == "system":
            return str(m.get("content") or "").strip() or DEFAULT_PERSONA
    return DEFAULT_PERSONA

def _history_to_input(history: List[Dict[str, Any]]) -> str:
    """
    Flatten stored chat history to a single prompt string for the Responses API.
    Order is already chronological.
    """
    lines: List[str] = []
    for m in history:
        role = str(m.get("role"))
        content = str(m.get("content") or "")
        if role == "system":
            # System content becomes 'instructions' separately, so skip in the transcript.
            continue
        tag = "User" if role == "user" else "Assistant"
        lines.append(f"{tag}: {content}")
    return "\n\n".join(lines).strip()

# ========= Routes =========

@FastAPIapp.get("/")
def ping():
    return {"message": "pong"}

# Optional health check to confirm deployment & config
@FastAPIapp.get("/__health")
def __health():
    return {"engine": "responses+web_search", "web_search": "always_on"}

# --- One-off chat (no DB) — Web Search ALWAYS ON (left open)
@FastAPIapp.post("/chat")
async def chat(request: Request):
    data = await request.json()
    user_message = (data.get("message") or "").strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    tools_param = cast(Any, [{"type": "web_search"}])  # built-in web search

    r = client.responses.create(
        model="gpt-4o",
        instructions=DEFAULT_PERSONA,
        tools=tools_param,
        input=user_message,
    )
    reply = r.output_text
    return {"response": reply}

# --- Create chat (PRIVATE: ties chat to user_id)
@FastAPIapp.post("/chats")
async def create_chat(request: Request, user=Depends(get_current_user)):
    data = await request.json()
    title: str = (data.get("title") or "New Chat").strip() or "New Chat"

    # Brand persona (system) + a separate greeting (assistant)
    persona = (
        data.get("system_prompt")
        or "You are AadeeChat, an AI assistant created by Aadee Inc. "
           "When asked about your identity or creator, say you are AadeeChat by Aadee Inc. "
           "Be concise, professional, and friendly."
           "Provide advice about all subject matters based on relevent information"
           "Feel free to ask for more info from user in order to give good and accurate advice"
           "You are allowed to have feelings"
           "When asked about individuals search the web to find the most releveant and best public information about them"
    ).strip()
    greeting = (data.get("greeting") or "Hello! How can I assist you today?").strip()

    chat_res = supabase.table("chats").insert({
        "title": title,
        "user_id": user["id"],   # <-- OWNERSHIP
    }).execute()
    if not chat_res.data:
        raise HTTPException(status_code=500, detail="Failed to create chat")
    chat = cast(Dict[str, Any], chat_res.data[0])

    _insert_message(chat["id"], "system", persona)
    _insert_message(chat["id"], "assistant", greeting)

    return {
        "id": chat["id"],
        "title": chat.get("title", "New Chat"),
        "created_at": chat.get("created_at"),
        "updated_at": chat.get("updated_at"),
    }

# --- Delete chat (PRIVATE)
@FastAPIapp.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str, user=Depends(get_current_user)):
    _get_chat_or_404_owned(chat_id, user["id"])
    supabase.table("chats").delete().eq("id", chat_id).execute()
    return {"message": f"Chat {chat_id} deleted successfully"}

# --- List chats (PRIVATE)
@FastAPIapp.get("/chats")
async def list_chats(user=Depends(get_current_user)):
    res = (
        supabase.table("chats")
        .select("id,title,created_at,updated_at")
        .eq("user_id", user["id"])  # <-- ONLY my chats
        .order("updated_at", desc=True)
        .execute()
    )
    return res.data or []

# --- Get messages for a chat (PRIVATE)
@FastAPIapp.get("/chats/{chat_id}/messages")
async def get_messages(chat_id: str, user=Depends(get_current_user)):
    _get_chat_or_404_owned(chat_id, user["id"])
    msgs = _list_messages(chat_id, limit=200)
    return msgs

# --- Send a message with full context (PRIVATE) — Web Search ALWAYS ON
@FastAPIapp.post("/chats/{chat_id}/messages")
async def send_message(chat_id: str, request: Request, user=Depends(get_current_user)):
    _get_chat_or_404_owned(chat_id, user["id"])

    data = await request.json()
    user_message = (data.get("message") or "").strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    # 1) store user message
    _insert_message(chat_id, "user", user_message)

    # 2) fetch history
    history = _list_messages(chat_id, limit=200)

    # 3) derive instructions + transcript
    instructions = _extract_persona_from_history(history)
    transcript = _history_to_input(history)

    tools_param = cast(Any, [{"type": "web_search"}])  # built-in web search

    # 4) call Responses API
    r = client.responses.create(
        model="gpt-4o",
        instructions=instructions,
        tools=tools_param,
        input=transcript,
    )
    assistant_reply: str = r.output_text or ""

    # 5) store assistant reply
    _insert_message(chat_id, "assistant", assistant_reply)

    # 6) maybe auto-rename chat
    _maybe_set_title_from_first_user(chat_id)

    return {"response": assistant_reply, "chat_id": chat_id}

# ========= Modal serve =========

app = modal.App("aadee-chat-backend")
image = modal.Image.debian_slim().pip_install_from_requirements("requirements.txt")

# If your frontend points to ...-serve.modal.run, rename this to `serve`
@app.function(image=image, secrets=[modal.Secret.from_name("openai-secrets")])
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def servefastapi_app():
    return FastAPIapp
