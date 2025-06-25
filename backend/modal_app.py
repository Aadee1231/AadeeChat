import modal

# Your Modal App name
app = modal.App("aadee-backend")

# This should be the absolute path or relative path to your local backend folder
BACKEND_DIR = "./"  # assumes modal_app.py is in the backend folder

# Build an image with the backend code and requirements
image = (
    modal.Image.debian_slim()
    .add_local_dir(".", BACKEND_DIR, exclude=["__pycache__"])
    .pip_install_from_requirements("requirements.txt")
)

# Create a function to serve your FastAPI app
@app.function(image=image)
@modal.asgi_app()
def fastapi_app():
    from main import app
    return app
