import modal

stub = modal.Stub("aadee-backend")
image = modal.Image.debian_slim().pip_install_from_requirements("requirements.txt")

@stub.function(image=image, keep_warm=1, mounts=[modal.Mount.from_local_dir(".", remote_path="/app")])
@modal.asgi_app()
def fastapi_app():
    import main  # This loads the FastAPI app in main.py
    return main.app
