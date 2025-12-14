// --- GLOBAL STATE & API CONFIGURATION ---
let tasks = [];
// API_BASE is the root of the task management API on the Flask server
const API_BASE = '/api/tasks';

// State to hold the ID of the task currently being deleted
let taskToDeleteId = null;

// --- UTILITY FUNCTIONS ---

/**
 * Renders an informational message (success or error).
 * @param {string} message - The text message to display.
 * @param {boolean} isSuccess - True for success (green), false for error (red).
 */
function showMessage(message, isSuccess = true) {
    const container = document.getElementById('message-container');
    const alertDiv = document.createElement('div');
    alertDiv.className = `message-alert ${isSuccess ? 'message-success' : 'message-error'}`;
    alertDiv.textContent = message;

    // Append new message
    container.prepend(alertDiv);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        alertDiv.style.opacity = '0';
        alertDiv.style.transform = 'translateY(-10px)';
        setTimeout(() => alertDiv.remove(), 300); // Remove from DOM after transition
    }, 5000);
}

/**
 * Handles API calls with exponential backoff for resilience.
 * @param {string} url - The API endpoint path.
 * @param {object} options - Fetch options (method, headers, body).
 * @param {number} retries - Maximum number of retries.
 * @returns {Promise<object>} The parsed JSON response.
 */
async function fetchWithBackoff(url, options, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);

            // Handle HTTP errors (4xx, 5xx)
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `HTTP Error: ${response.status} ${response.statusText}` }));
                throw new Error(errorData.message || `HTTP Error: ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                 // Handle API-defined logical errors (e.g., login failure)
                throw new Error(data.message || "An unknown error occurred on the server.");
            }
            return data;

        } catch (error) {
            console.error(`Attempt ${i + 1} failed for ${options.method} ${url}: ${error.message}`);
            if (i === retries - 1) {
                throw new Error(`Failed to connect/process request: ${error.message}`);
            }
            // Exponential backoff delay
            const delay = Math.pow(2, i) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// --- AUTHENTICATION LOGIC ---

/**
 * Toggles visibility between the Auth and App screens.
 */
function toggleAppView(isLoggedIn) {
    document.getElementById('auth-screen').classList.toggle('hidden', isLoggedIn);
    document.getElementById('app-screen').classList.toggle('hidden', !isLoggedIn);
    document.getElementById('logout-button').classList.toggle('hidden', !isLoggedIn);

    if (isLoggedIn) {
        // Fetch tasks immediately upon successful login/load
        fetchTasks();
    }
}

/**
 * Handles user registration submission.
 */
async function handleRegister(event) {
    event.preventDefault();
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;

    try {
        const response = await fetchWithBackoff('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        showMessage(response.message, response.success);
        if (response.success) {
            // Switch to login form after successful registration
            document.getElementById('toggle-login-btn').click();
        }
    } catch (error) {
        showMessage(`Registration failed: ${error.message}`, false);
    }
}

/**
 * Handles user login submission.
 */
async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const response = await fetchWithBackoff('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        // Store the JWT token from Flask response for subsequent API calls
        localStorage.setItem('userToken', response.token);
        showMessage("Login successful! Welcome back.", true);
        toggleAppView(true);

    } catch (error) {
        showMessage(`Login failed: ${error.message}`, false);
    }
}

/**
 * Logs the user out.
 */
function handleLogout() {
    localStorage.removeItem('userToken');
    tasks = []; // Clear local tasks
    showMessage("You have been logged out.", true);
    toggleAppView(false);
}

/**
 * Utility to get the auth header for protected routes.
 */
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('userToken')}`
    };
}

// --- TASK CRUD LOGIC ---

/**
 * Fetches all tasks from the Flask API and updates the UI.
 */
async function fetchTasks() {
    try {
        const response = await fetchWithBackoff(API_BASE, {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (response.success) {
            tasks = response.tasks || [];
            renderTasks();
        }
    } catch (error) {
        // If 401 Unauthorized, automatically log out
        if (error.message.includes('Token is invalid') || error.message.includes('Token is missing')) {
            handleLogout();
            showMessage('Session expired. Please log in again.', false);
        } else {
            showMessage(`Failed to load tasks: ${error.message}`, false);
        }
    }
}

/**
 * Renders the current list of tasks into the DOM, separated by status (Kanban board).
 */
function renderTasks() {
    const container = document.getElementById('task-board');
    container.innerHTML = ''; // Clear previous content

    const statuses = ['To Do', 'In Progress', 'Completed'];

    statuses.forEach(status => {
        const columnWrapper = document.createElement('div');
        columnWrapper.className = 'task-column-wrapper';

        const statusClass = status.replace(/\s/g, '-').toLowerCase();

        columnWrapper.innerHTML = `
            <div class="task-column">
                <h2 class="task-column-title status-${statusClass}">${status}</h2>
                <div id="column-${status.replace(/\s/g, '-')}" class="task-list-container">
                    <!-- Tasks injected here -->
                </div>
            </div>
        `;
        container.appendChild(columnWrapper);

        const taskList = document.getElementById(`column-${status.replace(/\s/g, '-')}`);
        const filteredTasks = tasks.filter(t => t.status === status);

        if (filteredTasks.length === 0) {
             taskList.innerHTML = `<p class="text-gray-500 text-sm italic p-2">No tasks in this category.</p>`;
        }

        filteredTasks.forEach(task => {
            const taskElement = createTaskCard(task);
            taskList.appendChild(taskElement);
        });
    });
}

/**
 * Creates an individual task card DOM element.
 */
function createTaskCard(task) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.setAttribute('data-id', task._id);
    // Format the date for display
    const date = new Date(task.created_at).toLocaleDateString('en-US');

    card.innerHTML = `
        <h3 class="task-card-title">${task.title}</h3>
        <p class="task-card-description">${task.description.substring(0, 80)}${task.description.length > 80 ? '...' : ''}</p>
        <div class="task-card-footer">
            <span>Created: ${date}</span>
            <button onclick="openEditModal('${task._id}')" class="task-card-edit-btn">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-7-3l2.293-2.293a1 1 0 011.414 0l1.414 1.414a1 1 0 010 1.414L10 14m-3 3l.044-.044M18 10a8 8 0 11-16 0 8 8 0 0116 0z" />
                </svg>
                Edit
            </button>
        </div>
    `;
    return card;
}

// --- MODAL CONTROL LOGIC ---

function openCreateModal() {
    const modal = document.getElementById('task-modal');
    document.getElementById('modal-title').textContent = 'Create New Task';
    document.getElementById('task-id').value = ''; // Clear ID for creation
    document.getElementById('task-form').reset();
    document.getElementById('delete-button').classList.add('hidden');
    modal.classList.remove('hidden');
}

function closeTaskModal() {
    document.getElementById('task-modal').classList.add('hidden');
}

function openEditModal(taskId) {
    const task = tasks.find(t => t._id === taskId);
    if (!task) {
        showMessage('Task not found.', false);
        return;
    }

    // Set the ID for deletion/update reference
    document.getElementById('task-id').value = taskId;
    taskToDeleteId = taskId; // Set global state for confirmation modal

    const modal = document.getElementById('task-modal');
    document.getElementById('modal-title').textContent = 'Edit Task';
    document.getElementById('task-title').value = task.title;
    document.getElementById('task-description').value = task.description;
    document.getElementById('task-status').value = task.status;
    document.getElementById('delete-button').classList.remove('hidden');
    modal.classList.remove('hidden');
}

/**
 * Opens the custom confirmation modal (replaces window.confirm()).
 */
function openConfirmModal() {
    document.getElementById('confirm-modal').classList.remove('hidden');
    document.getElementById('task-modal').classList.add('hidden'); // Hide the main task modal
}

/**
 * Closes the custom confirmation modal.
 */
function closeConfirmModal() {
    document.getElementById('confirm-modal').classList.add('hidden');
    // If we were in the middle of editing, bring back the main modal
    if (taskToDeleteId) {
        document.getElementById('task-modal').classList.remove('hidden');
    }
}

/**
 * Executes the deletion after confirmation.
 */
async function confirmAndDelete() {
    closeConfirmModal(); // Hide confirmation modal first
    const taskId = taskToDeleteId;
    if (!taskId) return;

    try {
        const response = await fetchWithBackoff(`${API_BASE}/${taskId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (response.success) {
            showMessage("Task deleted successfully.", true);
            closeTaskModal();
            taskToDeleteId = null; // Clear state
            await fetchTasks(); // Refresh list
        }
    } catch (error) {
        showMessage(`Deletion failed: ${error.message}`, false);
    }
}


/**
 * Handles the submission of the create/edit task form.
 */
async function handleTaskSubmit(event) {
    event.preventDefault();
    const taskId = document.getElementById('task-id').value;
    const title = document.getElementById('task-title').value;
    const description = document.getElementById('task-description').value;
    const status = document.getElementById('task-status').value;

    const taskData = { title, description, status };

    try {
        let response;
        if (taskId) {
            // UPDATE (PUT)
            response = await fetchWithBackoff(`${API_BASE}/${taskId}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(taskData)
            });
        } else {
            // CREATE (POST)
            response = await fetchWithBackoff(API_BASE, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(taskData)
            });
        }

        showMessage(response.message, response.success);
        if (response.success) {
            closeTaskModal();
            await fetchTasks(); // Refresh list
        }
    } catch (error) {
        showMessage(`Error: ${error.message}`, false);
    }
}

// --- INITIALIZATION ---

window.onload = function() {
    // Check if user is logged in via token
    const token = localStorage.getItem('userToken');
    toggleAppView(!!token);

    // Setup form listeners
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('task-form').addEventListener('submit', handleTaskSubmit);

    // Listener to switch between login and register forms
    document.getElementById('toggle-register-btn').addEventListener('click', () => {
        document.getElementById('login-form').classList.add('hidden');
        document.getElementById('register-form').classList.remove('hidden');
        document.getElementById('toggle-login-btn').classList.remove('hidden');
        document.getElementById('toggle-register-btn').classList.add('hidden');
    });

    document.getElementById('toggle-login-btn').addEventListener('click', () => {
        document.getElementById('login-form').classList.remove('hidden');
        document.getElementById('register-form').classList.add('hidden');
        document.getElementById('toggle-login-btn').classList.add('hidden');
        document.getElementById('toggle-register-btn').classList.remove('hidden');
    });
};