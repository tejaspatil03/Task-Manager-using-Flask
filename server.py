import os
from flask import Flask, request, jsonify, send_from_directory
from flask_pymongo import PyMongo
from bson.objectid import ObjectId
from functools import wraps
import hashlib
# FIX: Reverting to simple import 'import jwt' and handling exceptions
# This often resolves issues where an older/misnamed file shadows the correct PyJWT package.
import jwt 
# FIX 2: Importing InvalidTokenError directly from the 'jwt' module (top level) 
# as the 'jwt.exceptions' path is failing for the user's local setup.
try:
    from jwt import InvalidTokenError
except ImportError:
    # Fallback for very old versions where it might be in an unexpected place
    # or the simple 'import jwt' already placed it in the namespace.
    InvalidTokenError = jwt.exceptions.InvalidTokenError

import datetime

# --- Configuration ---
app = Flask(__name__)
current_dir = os.path.dirname(os.path.abspath(__file__))

# NOTE: Replace the URI below with your actual connection string if you change cluster details.
# This URI points to the 'task' database and uses the 'stepup' credentials you provided.
app.config["MONGO_URI"] = "mongodb+srv://stepup:123@stepup.wztrxem.mongodb.net/task?retryWrites=true&w=majority"
app.config["SECRET_KEY"] = "rM_F-lB3aV5Kz2Q9-tE1c7gO5yJ4X8W0" # Use a strong, unique secret key

# Database and collection names
DB_NAME = "task"
COLLECTION_NAME = "scripts" # Tasks collection name

mongo = PyMongo(app)
# Since MONGO_URI contains "/task", mongo.db already points to the 'task' database.
tasks_collection = mongo.db[COLLECTION_NAME]
users_collection = mongo.db["users"]

# --- Utility Functions ---

def hash_password(password):
    """Hashes a password using SHA256."""
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def auth_required(f):
    """Decorator to check for a valid JWT in the Authorization header."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        # JWT token is expected in the format: "Bearer <token>"
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            if auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]

        if not token:
            return jsonify({'message': 'Authentication Token is missing!'}), 401

        try:
            # Decode the JWT token to get user data
            # Use jwt.decode (standard PyJWT call)
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            # The user_id stored in the token is what we use to authorize tasks
            request.current_user = data['user_id']
        except InvalidTokenError as e:
            print(f"JWT Decode Error (Invalid): {e}")
            return jsonify({'message': 'Token is invalid or expired!'}), 401
        except Exception as e:
            print(f"JWT Decode Error (General): {e}")
            return jsonify({'message': 'A token processing error occurred.'}), 401


        return f(*args, **kwargs)
    return decorated

# --- Frontend Routes ---

# Serve index.html from the same directory
@app.route('/')
def index():
    """Serves the main HTML page."""
    return send_from_directory(current_dir, 'index.html')

# Serve style.css from the same directory
@app.route('/style.css')
def serve_css():
    """Serves the CSS file."""
    return send_from_directory(current_dir, 'style.css')

# Serve script.js from the same directory
@app.route('/script.js')
def serve_js():
    """Serves the JavaScript file."""
    return send_from_directory(current_dir, 'script.js')

# --- User API Routes ---

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({'success': False, 'message': 'Email and password are required.'}), 400

    if users_collection.find_one({'email': email}):
        return jsonify({'success': False, 'message': 'User already exists.'}), 409

    # Hash the password and insert user
    hashed_password = hash_password(password)
    user_id = users_collection.insert_one({'email': email, 'password': hashed_password}).inserted_id

    return jsonify({'success': True, 'message': 'Registration successful. Please log in.', 'user_id': str(user_id)}), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({'success': False, 'message': 'Email and password are required.'}), 400

    user = users_collection.find_one({'email': email})

    if user and user['password'] == hash_password(password):
        # Prepare payload: ensure ObjectId is converted to string for JWT
        token_payload = {
            'user_id': str(user['_id']),
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24) # Token expires in 24 hours
        }
        # Generate JWT token - Use jwt.encode (standard PyJWT call)
        token = jwt.encode(token_payload, app.config['SECRET_KEY'], algorithm="HS256")

        return jsonify({'success': True, 'message': 'Login successful.', 'token': token}), 200
    else:
        return jsonify({'success': False, 'message': 'Invalid credentials.'}), 401

# --- Task API Routes (Protected) ---

def task_document_to_json(doc):
    """Converts a MongoDB document to a JSON serializable dictionary."""
    doc['_id'] = str(doc['_id'])
    return doc

@app.route('/api/tasks', methods=['GET'])
@auth_required
def get_tasks():
    """Retrieves all tasks for the current user."""
    user_id = request.current_user
    try:
        # Find tasks belonging to the current user
        # Note: 'user_id' in MongoDB is a string (as stored from the JWT)
        tasks_cursor = tasks_collection.find({'user_id': user_id}).sort("created_at", 1)
        tasks_list = [task_document_to_json(task) for task in tasks_cursor]
        return jsonify({'success': True, 'tasks': tasks_list}), 200
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error retrieving tasks: {str(e)}'}), 500

@app.route('/api/tasks', methods=['POST'])
@auth_required
def create_task():
    """Creates a new task."""
    data = request.get_json()
    user_id = request.current_user

    if not data.get('title'):
        return jsonify({'success': False, 'message': 'Title is required.'}), 400

    new_task = {
        'user_id': user_id,
        'title': data['title'],
        'description': data.get('description', ''),
        'status': data.get('status', 'To Do'),
        'created_at': datetime.datetime.utcnow()
    }

    try:
        result = tasks_collection.insert_one(new_task)
        # Find the inserted document to return the full JSON representation
        inserted_doc = tasks_collection.find_one({'_id': result.inserted_id})
        new_task_json = task_document_to_json(inserted_doc)
        return jsonify({'success': True, 'message': 'Task created successfully.', 'task': new_task_json}), 201
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error creating task: {str(e)}'}), 500

@app.route('/api/tasks/<task_id>', methods=['PUT'])
@auth_required
def update_task(task_id):
    """Updates an existing task."""
    data = request.get_json()
    user_id = request.current_user

    if not ObjectId.is_valid(task_id):
        return jsonify({'success': False, 'message': 'Invalid task ID format.'}), 400

    # Only allow specific fields to be updated
    update_fields = {
        key: value for key, value in data.items() if key in ['title', 'description', 'status']
    }

    try:
        result = tasks_collection.update_one(
            {'_id': ObjectId(task_id), 'user_id': user_id}, # Filter by both ID and User ID
            {'$set': update_fields}
        )

        if result.matched_count == 0:
            return jsonify({'success': False, 'message': 'Task not found or unauthorized.'}), 404

        return jsonify({'success': True, 'message': 'Task updated successfully.'}), 200
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error updating task: {str(e)}'}), 500

@app.route('/api/tasks/<task_id>', methods=['DELETE'])
@auth_required
def delete_task(task_id):
    """Deletes a task."""
    user_id = request.current_user

    if not ObjectId.is_valid(task_id):
        return jsonify({'success': False, 'message': 'Invalid task ID format.'}), 400

    try:
        result = tasks_collection.delete_one({'_id': ObjectId(task_id), 'user_id': user_id})

        if result.deleted_count == 0:
            return jsonify({'success': False, 'message': 'Task not found or unauthorized.'}), 404

        return jsonify({'success': True, 'message': 'Task deleted successfully.'}), 200
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error deleting task: {str(e)}'}), 500


if __name__ == '__main__':
    # Initial MongoDB connection check is implicitly handled by PyMongo(app) and the first operation.
    try:
        # A simple check to confirm the connection is ready before starting the server
        mongo.cx.admin.command('ping')
        print("MongoDB connection status: Success (URI appears valid).")
    except Exception:
        print("Warning: MongoDB connection failed with provided URI. Check network and credentials.")

    # For development
    app.run(debug=True, host='0.0.0.0')