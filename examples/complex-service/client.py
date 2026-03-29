import requests

def fetch_user(user_id):
    response = requests.get(f"http://localhost/user?id={user_id}")
    return response.json()
