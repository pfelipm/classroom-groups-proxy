🇪🇸 [Versión en Español](README.md)

# Classroom Groups Proxy

## 1. What It Is and What It's For

**Classroom Groups Proxy** is a web application built on Google Apps Script that acts as a bridge between Google Classroom and Google Groups. Its main purpose is to allow teachers (or any user in the domain) to create Google Groups from their Google Classroom participants in a fast, secure, and controlled manner.

This tool addresses the need to interact with class members outside the confines of Google Classroom, facilitating actions such as:

*   **Easy Resource Sharing**: Email links to Gemini gems, NotebookLM notebooks, Drive files, or any other web resource to the entire class or just the teachers.
*   **Creating Communication Spaces**: Generate a Google Chat space from the new Google Group.
*   **Organizing Events**: Invite all class members to a Google Calendar event with a single email address.
*   **Establishing a Formal Communication Channel**: Use the group's mailing list as an official channel for important announcements.

The application functions as a "proxy" because it must be deployed by a **Super Administrator** of the Google Workspace domain. This way, the group creation process (an administrative task) is performed with the administrator's permissions, but the action is initiated by a non-privileged user (a teacher), who can only see and act upon their own classes.

## 2. How to Get, Deploy, and Use It

The deployment of this tool is a process that must be carried out by a **Super Administrator** of the Google Workspace domain.

### Deployment Steps

1.  **Create a Google Sheet**: Create a new Google Sheet in your Drive.
2.  **Prepare Log Sheets**: Rename the default sheet to `Registro de Operaciones` and create a second sheet named `Grupos Creados`. These sheets will be used to log the application's activity.
3.  **Open the Apps Script Editor**: Inside the spreadsheet, go to `Extensions > Apps Script`.
4.  **Copy the Project Code**:
    *   An Apps Script project will open with a `Code.gs` file. Delete its content and paste the content from the [`Code.gs`](Code.gs) file of this repository.
    *   Create the `appsscript.json` file in the editor and paste the content from the [`appsscript.json`](appsscript.json) file of this repository. This step is **crucial** for enabling the necessary APIs and permissions.
    *   Create a new HTML file named `index.html`. To do this, click the `+` icon next to `Files` and select `HTML`. Paste the content of the [`index.html`](index.html) file from this repository into it.
    *   Create another HTML file named `main.html` and paste the content of the [`main.html`](main.html) file from this repository into it.
5.  **Save the Project**: Click the save icon (floppy disk).
6.  **Deploy the Web Application**:
    *   Click the `Deploy` button and select `New deployment`.
    *   In the configuration window, adjust the following settings:
        *   **Description**: Give it a descriptive name, like "Classroom Groups Proxy".
        *   **Execute as**: `Me` (the email of the administrator performing the deployment).
        *   **Who has access**: `Anyone within [Your Domain]`.
    *   Click `Deploy`.
7.  **Authorize Permissions**: The first time you deploy, Google will ask you to authorize the permissions (OAuth scopes) that the script needs to function. Review and accept the permissions.
8.  **Get and Share the URL**: Once deployed, you will be provided with a web app URL. This is the URL you should share with teachers and other users in your domain so they can use the tool.

## 3. Detailed Features

The application's interface guides the user through a simple three-step process.

### Step 1: Course Selection

*   The application automatically detects the user and presents a dropdown menu with all the Google Classroom courses in which they are a teacher.
*   Upon selecting a course, the **automatic groups** that Classroom already creates by default (one for teachers and one for the whole class) are displayed, which may be sufficient for certain tasks like sharing files in Drive.

### Step 2: User Selection

*   Once a course is selected, the application loads two lists: **Teachers** and **Students**.
*   **Flexible Selection**:
    *   By default, all users in both lists are pre-selected.
    *   You can uncheck any user individually.
    *   You can use the "Select all" checkboxes to quickly check or uncheck all teachers or all students.
    *   The user creating the group (the teacher) is always included as the **owner** of the new group and cannot be deselected.

### Step 3: Group Configuration and Creation

*   Before creating the group, you can adjust three key settings:
    1.  **Make teachers group managers**: If checked, all teachers in the course (except the owner) will get the "Manager" role in the group, allowing them to manage members and settings.
    2.  **Only owners and managers can send messages**: Restricts the ability to post in the group to only managers and owners. Very useful for one-way announcement groups.
    3.  **Make visible in Google Groups**: If enabled, the group will appear in the Google Groups directory and will keep an archive of all conversations sent to the mailing list.
*   When you click **"Create Group"**, the backend handles the entire process. The group email is automatically generated with the format `cgp-[course-name]-[course-id]@[domain]`.

### Other Features

*   **CSV Export**: At each step, there are buttons to export the list of courses or the list of users from the selected course to a CSV file.
*   **Activity Logging**: The spreadsheet hosting the script uses two tabs for activity logging. If these sheets do not exist, the script will create them on its first run:
    *   `Registro de Operaciones` (Operation Log): Saves a line for each action performed (loading courses, creating a group, errors, etc.), indicating who did it and when.
    *   `Grupos Creados` (Created Groups): Keeps a record of all groups that have been created with the tool.
*   **Internationalization (i18n)**: The interface is available in Spanish and English and automatically switches based on the user's browser language.

## 4. Detailed Technical Analysis

The project follows a simple client-server architecture, typical of Apps Script web applications.

*   `Code.gs`: This is the **backend** of the application.
    *   `doGet(e)`: The main entry point. It serves the `index.html` file when a user accesses the web app URL.
    *   `obtenerCursos()`, `obtenerUsuarios(idCurso)`: Functions that communicate with the **Google Classroom API** to get the necessary data.
    *   `crearGrupoDeClase(datosGrupo)`: The most complex function. It uses the **Admin SDK Directory API** to create the group and add members, and the **Admin SDK Groups Settings API** to apply the visibility and posting permission settings. It includes a retry mechanism with exponential backoff to verify that the group has propagated through Google's systems before attempting to add members.
    *   `_logOperation(...)`, `_logGroupCreation(...)`: Internal functions for writing to the corresponding spreadsheets.
    *   `esUsuarioAdmin()`: Checks if the user who deployed the app is an administrator, a critical security check.

*   `index.html`: This is the **frontend structure**.
    *   A standard HTML file that uses **Bootstrap 5** for design and responsiveness.
    *   Defines all UI elements: selectors, lists, buttons, modals, etc.
    *   Includes the `main.html` file at the end to load the JavaScript logic.

*   `main.html`: Contains the **frontend logic** in JavaScript.
    *   Uses `document.addEventListener('DOMContentLoaded', ...)` to start the script once the page has loaded.
    *   Manages all interface events (clicks, changes in the selector, etc.).
    *   Communicates with the backend (`Code.gs`) asynchronously using `google.script.run`. This is the mechanism that allows a web page to execute Apps Script functions.
    *   Handles the internationalization (i18n) logic, changing the interface texts according to the selected language.

*   `appsscript.json`: This is the **project manifest**. A vital JSON configuration file.
    *   `timeZone`: Defines the project's time zone.
    *   `dependencies`: Declares the advanced Google services that the script will use (Classroom, AdminDirectory, GroupsSettings).
    *   `webapp`: Configures the execution mode of the web app. `"executeAs": "USER_DEPLOYING"` is the key to the "proxy" model.
    *   `oauthScopes`: Lists all the permissions the script needs to function. The user (the administrator) must authorize these permissions during deployment.

## 5. License

This project is licensed under the **[GNU General Public License v3.0 (GNU GPL v3)](LICENSE)**.
