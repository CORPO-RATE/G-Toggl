// --- Configuration / Input Values ---
const TOGGL_API_TOKEN = "XXXXX"; // **REPLACE with your token**
const TOGGL_EMAIL = "XXXXX";      // **REPLACE with your email** (Not used)
const TOGGL_PASSWORD = "XXXXX";     // **REPLACE with your password** (Not used, should be removed)
const SPREADSHEET_ID = "XXXXX"; // **REPLACE with your Spreadsheet ID**
const SHEET_NAME = "XXXXX"; // Sheet name

// --- Global Variables for Date Inputs --- (Not strictly necessary)
let startDateInput;
let endDateInput;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Toggl')
    .addItem('Get Time Entries', 'showSidebar')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('sidebar') // Make sure 'sidebar.html' exists
    .setTitle('Toggl Time Entries');
  SpreadsheetApp.getUi()
    .showSidebar(html);
}

// Called from the sidebar with date strings
function getTimeEntriesFromSidebar(startDateStr, endDateStr) {
  const startDate = startDateStr ? new Date(startDateStr) : null;
  const endDate = endDateStr ? new Date(endDateStr) : null;

  const timeEntries = getTimeEntries(startDate, endDate);
  if (timeEntries) {
    writeTimeToSpreadsheet(timeEntries, SPREADSHEET_ID, SHEET_NAME);
  }
}

function makeRequest(method, endpoint, params, data) {
  const authString = `${TOGGL_API_TOKEN}:api_token`;
  const authBytes = Utilities.newBlob(authString).getBytes();
  const base64String = Utilities.base64Encode(authBytes);

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Basic ${base64String}`
  };

  const BASE_URL = "https://api.track.toggl.com/api/v9/";
  let url = BASE_URL + endpoint;

  if (params) {
    url += "?" + Object.keys(params).map(key => `${key}=${encodeURIComponent(params[key])}`).join("&");
  }

  const options = {
    'method': method,
    'headers': headers,
    'muteHttpExceptions': true
  };

  if (data) {
    options.payload = JSON.stringify(data);
  }

  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();

  if (statusCode === 200) {
    try {
      return JSON.parse(response.getContentText());
    } catch (e) {
      Logger.log(`Error decoding JSON response: ${response.getContentText()}`);
      return null;
    }
  } else {
    Logger.log(`API Error: ${statusCode} - ${response.getContentText()}`);
    return null;
  }
}

function getTimeEntries(startDate, endDate) {
  function formatDate(date) {
    return date.toISOString().replace(/.\d+Z$/, 'Z');
  }

  if (!startDate) {
    startDate = new Date();
    startDate.setDate(startDate.getDate() - 7); // Default to last 7 days
  }
  if (!endDate) {
    endDate = new Date(); // Default to today
  }

  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);

  const params = {
    start_date: startDateStr,
    end_date: endDateStr
  };

  let timeEntries = makeRequest("GET", "me/time_entries", params);

  if (timeEntries) {
    // Get unique workspace IDs and project IDs
    const workspaceIds = [...new Set(timeEntries.map(entry => entry.workspace_id))];
        const projectIds = [...new Set(timeEntries.map(entry => entry.project_id).filter(id => id != null))];


    // Fetch projects for each workspace (avoid redundant calls)
    const projectsByWorkspace = {};
    const projectsById = {}; // Create a map of project ID to project object

    for (const workspaceId of workspaceIds) {
      const projects = makeRequest("GET", `workspaces/${workspaceId}/projects`);
      if (projects) {
        projectsByWorkspace[workspaceId] = projects;
          projects.forEach(project => {
              projectsById[project.id] = project; // Populate the project ID map
          });
      }
    }


    // Add project names and workspace names to time entries.
    timeEntries = timeEntries.map(entry => {
       // Use projectsById for direct lookup
      if (entry.project_id) {
        const project = projectsById[entry.project_id];
        entry.project = project ? { name: project.name } : null;
      }
       const workspace = makeRequest("GET", `workspaces/${entry.workspace_id}`);
        if(workspace){
            entry.workspace = workspace? {name: workspace.name}: null;
        }

      return entry;
    });
    return timeEntries;

  } else {
    Logger.log("Failed to retrieve time entries.");
    return null;
  }
}


function writeTimeToSpreadsheet(timeEntries, spreadsheetId, sheetName) {
  if (!timeEntries || timeEntries.length === 0) {
    Logger.log("No time entries to write.");
    return;
  }

  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    let sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow([
        "ID", "Start Time", "End Time", "Duration", "Description", "Project", "Workspace", "Tags", "Task"
      ]);
    }

    const existingIds = sheet.getRange(2, 1, sheet.getLastRow() - 1 > 0 ? sheet.getLastRow() - 1 : 1, 1).getValues().flat();
    const dataToWrite = [];

    timeEntries.forEach(entry => {
      if (existingIds.includes(entry.id)) {
        Logger.log(`Skipping duplicate entry with ID: ${entry.id}`);
        return;
      }
      const startTime = new Date(entry.start);
      const endTime = new Date(entry.stop);

      const projectName = entry.project ? entry.project.name : "";
      const workspaceName = entry.workspace ? entry.workspace.name : "";
      const taskName = entry.task ? entry.task.name : "";

      dataToWrite.push([
        entry.id,
        startTime.toLocaleString(),
        endTime.toLocaleString(),
        entry.duration,
        entry.description,
        projectName,
        workspaceName,
        entry.tags ? entry.tags.join(", ") : "",
        taskName
      ]);
    });

    if (dataToWrite.length > 0) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, dataToWrite.length, dataToWrite[0].length).setValues(dataToWrite);
      Logger.log(`${dataToWrite.length} time entries written to sheet ${sheetName} in spreadsheet ${spreadsheetId}.`);
    } else {
      Logger.log("No new time entries to write.");
    }

  } catch (error) {
    Logger.log(`Error writing to spreadsheet: ${error}`);
  }
}

// Test function
function testGetTimeEntriesAndWrite() {
  const timeEntries = getTimeEntries(startDateInput, endDateInput);
  if (timeEntries) {
    writeTimeToSpreadsheet(timeEntries, SPREADSHEET_ID, SHEET_NAME);
  }
}
//getProjects() is kept for debugging, but is unused in main execution flow.
function getProjects() {
  const workspaces = makeRequest("GET", "me/workspaces");

  if (workspaces) {
    workspaces.forEach(workspace => {
      const projects = makeRequest("GET", `workspaces/${workspace.id}/projects`);
      if (projects) {
        Logger.log(`Projects in workspace ${workspace.name}:`);
        Logger.log(JSON.stringify(projects, null, 2));
      } else {
        Logger.log(`Could not retrieve projects for workspace ${workspace.name}`);
      }
    });
  } else {
    Logger.log("Could not retrieve workspaces.");
  }
}
