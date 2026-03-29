import requests

def fetch_user():
    response = requests.get("http://localhost/user")
    return response.json()
