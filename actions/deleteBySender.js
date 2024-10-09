// Utility functions for date and time formatting
function formatDate(date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(
    date.getMonth() + 1
  ).padStart(2, "0")}/${String(date.getFullYear()).slice(-2)}`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

// Utility function to show or hide multiple elements
function toggleVisibility(isVisible, ...elements) {
  elements.forEach((element) => {
    if (isVisible) {
      element.classList.remove("hidden");
    } else {
      element.classList.add("hidden");
    }
  });
}

// Main function to handle batch deletion by sender
function batchDeleteSender(token, sender) {
  fetchEmails(token, "", `from:${sender}`, (totalEmails, messageIds) => {
    if (totalEmails > 0) {
      confirmDeletion(token, messageIds, sender);
    } else {
      showCustomModal(`No emails found from "${sender}".`);
    }
  });
}

// Search senders by query and display them with their email counts
function fetchEmailsBySearch(token, searchTerm, callback) {
  const sendersSet = new Set();

  fetchEmails(token, "", searchTerm, (totalEmails, messageIds) => {
    if (totalEmails === 0) {
      toggleLoadingSpinner(false);
      showCustomModal("No results found.");
      return;
    }

    const senderPromises = messageIds.map((messageId) =>
      fetchEmailDetails(token, messageId).then((emailData) => {
        const sender = extractSender(emailData);
        if (sender) sendersSet.add(sender);
      })
    );

    Promise.all(senderPromises)
      .then(() =>
        sortSendersAndFetchCounts(token, Array.from(sendersSet), callback)
      )
      .catch((error) => {
        console.error("Error processing email details:", error);
        toggleLoadingSpinner(false);
        showCustomModal("An error occurred while fetching email details.");
      });
  });
}

// Helper to extract sender's email address from email data
function extractSender(emailData) {
  if (emailData && emailData.headers) {
    const senderHeader = emailData.headers.find(
      (header) => header.name === "From"
    );
    return senderHeader ? extractEmailAddress(senderHeader.value) : null;
  }
  return null;
}

// Fetch all emails for each sender and return their counts
function fetchEmailsCountForSenders(token, sendersArray, callback) {
  const senderCounts = sendersArray.map(
    (sender) =>
      new Promise((resolve) => {
        fetchEmails(token, "", `from:${sender}`, (totalEmails) => {
          resolve({ sender, count: totalEmails || 0 });
        });
      })
  );

  Promise.all(senderCounts).then((sendersWithCounts) => {
    const validSenders = sendersWithCounts.filter(({ count }) => count > 0);
    callback(validSenders);
  });
}

// Extract the email address from the 'From' header
function extractEmailAddress(fromHeader) {
  const emailRegex = /<([^>]+)>/;
  const match = fromHeader.match(emailRegex);
  return match ? match[1].trim() : fromHeader.trim();
}

// Fetch email details with retry mechanism
function fetchEmailDetails(token, messageId, retries = 3) {
  const url = `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?fields=payload.headers`;

  return fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((response) => {
      if (!response.ok) throw new Error("Failed to fetch email details");
      return response.json();
    })
    .then((data) => data.payload || null)
    .catch((error) => {
      if (retries > 0) {
        console.warn(
          `Retrying fetch for message ID: ${messageId}... (${retries} attempts left)`
        );
        return new Promise((resolve) =>
          setTimeout(
            () => resolve(fetchEmailDetails(token, messageId, retries - 1)),
            500
          )
        );
      } else {
        console.error("Error fetching email details:", error);
        return null;
      }
    });
}

// Display senders with their email counts in the dropdown
function displaySendersWithEmailCounts(token, senders) {
  const senderSelect = document.getElementById("senderSelect");
  senderSelect.innerHTML = ""; // Clear previous options

  // Sort senders in ascending order of email count
  const sortedSenders = senders.slice().sort((a, b) => a.count - b.count);

  sortedSenders.forEach(({ sender, count }) => {
    const option = document.createElement("option");
    option.value = sender;
    option.textContent = `${sender} (${count} emails)`;
    senderSelect.appendChild(option);
  });

  toggleVisibility(
    true,
    senderSelect,
    document.getElementById("deleteBySenderConfirm"),
    document.getElementById("viewEmailsButton")
  );
  addViewEmailsListener(token);
}

// Add event listener for the "View Emails" button
function addViewEmailsListener(token) {
  const viewEmailsButton = document.getElementById("viewEmailsButton");
  viewEmailsButton.addEventListener("click", () => {
    const senderSelect = document.getElementById("senderSelect");
    const selectedSender = senderSelect.value;

    if (!selectedSender) {
      showCustomModal("Please select a sender first.");
      return;
    }

    toggleLoadingSpinner(true);
    fetchEmailsForSender(token, selectedSender);
  });
}

// Clear any previous email list displayed and hide buttons
function clearPreviousEmailList() {
  const senderSelect = document.getElementById("senderSelect");
  senderSelect.innerHTML = "";
  toggleVisibility(
    false,
    senderSelect,
    document.getElementById("viewEmailsButton"),
    document.getElementById("deleteBySenderConfirm")
  );
}

// Fetch emails for the selected sender and display subjects
function fetchEmailsForSender(token, sender) {
  fetchEmails(token, "", `from:${sender}`, (totalEmails, messageIds) => {
    if (totalEmails > 0) {
      fetchAndDisplayEmailSubjects(token, messageIds);
    } else {
      toggleLoadingSpinner(false);
      showCustomModal(`No results found for "${sender}".`);
    }
  });
}

// Display the email subjects in a new window
function openSubjectListWindow(subjects) {
  const listWindow = window.open(
    "listPage.html",
    "Data Table",
    "width=800,height=600"
  );
  const dataPayload = {
    title: "Email Subjects",
    columns: [
      { label: "Subject", key: "subject" },
      { label: "Date", key: "date" },
      { label: "Time", key: "time" },
    ],
    items: subjects,
  };

  // Function to send data to the new window
  const sendDataToWindow = () => {
    listWindow.postMessage(dataPayload, "*");
    clearInterval(checkWindowInterval);
  };

  // Send data when the window loads
  listWindow.addEventListener("load", sendDataToWindow);

  // Check every 100ms if the window is open and ready to receive messages
  const checkWindowInterval = setInterval(() => {
    if (listWindow && !listWindow.closed) {
      sendDataToWindow();
    }
  }, 100);
}
// Main function to fetch and display email subjects
function fetchAndDisplayEmailSubjects(token, messageIds) {
  const subjectPromises = messageIds.map((messageId) =>
    getEmailDetails(token, messageId)
  );

  Promise.all(subjectPromises).then((subjects) => {
    toggleLoadingSpinner(false);
    const validSubjects = subjects.filter((subject) => subject !== null);

    if (validSubjects.length === 0) {
      showCustomModal("No email subjects could be retrieved.");
    } else {
      openSubjectListWindow(validSubjects);
    }
  });
}

// Sort senders by email count and fetch counts
function sortSendersAndFetchCounts(token, sendersArray, callback) {
  fetchEmailsCountForSenders(token, sendersArray, (sendersWithCounts) => {
    const sortedSenders = sendersWithCounts.sort((a, b) => a.count - b.count);
    callback(sortedSenders);
  });
}

// Fetch and format individual email details
function getEmailDetails(token, messageId) {
  return fetchEmailDetails(token, messageId).then((emailData) => {
    if (emailData && emailData.headers) {
      const subject =
        getHeaderValue(emailData.headers, "Subject") || "(No Subject)";
      const date = new Date(
        getHeaderValue(emailData.headers, "Date") || Date.now()
      );

      return {
        subject,
        date: formatDate(date),
        time: formatTime(date),
      };
    }
    return null; // Return null if data is missing or fetch failed
  });
}

// Extract specific header value from email headers
function getHeaderValue(headers, headerName) {
  const header = headers.find((h) => h.name === headerName);
  return header ? header.value : null;
}
