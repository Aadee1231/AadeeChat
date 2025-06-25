from fastapi import FastAPI
from modal import App, asgi_app

from main import app as fastapi_app_instance

app = App("aadee-backend")

@app.function()
@asgi_app()
def fastapi_app():
    return fastapi_app_instance
