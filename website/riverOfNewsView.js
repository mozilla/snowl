netscape.security.PrivilegeManager.enablePrivilege("UniversalXPConnect");

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cr = Components.results;

const HTML_NS = "http://www.w3.org/1999/xhtml";

let gBrowserWindow = window.QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIWebNavigation).
                     QueryInterface(Ci.nsIDocShellTreeItem).
                     rootTreeItem.
                     QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIDOMWindow);

Components.utils.import("resource://snowl/datastore.js");

// FIXME: check safety of the link before inserting it into the href?
const ENTRY_TEMPLATE = ' \
  <div class="entry"> \
      @@sourceTitle@@: \
      <a href="@@link@@"> \
        @@subject@@ \
      </a> \
  </div> \
';

//      <span class="lastUpdated">@@timestamp@@</span> \
//      <span>@@author@@</span> \

// Escape XML special characters.
function escapeXML(aString) {
  aString = aString.replace(/\&/g, "&amp;");
  aString = aString.replace(/</g, "&lt;");
  aString = aString.replace(/>/g, "&gt;");
  return aString;
}

let RiverOfNews = {
  _selectMessages: function() {
    netscape.security.PrivilegeManager.enablePrivilege("UniversalXPConnect");

    let statement = SnowlDatastore.createStatement(
      "SELECT sources.title AS sourceTitle, subject, author, link, timestamp, content \
       FROM sources JOIN messages ON sources.id = messages.sourceID \
       JOIN parts ON messages.id = parts.messageID \
       ORDER BY timestamp DESC"
    );

    let messages = [];
    try {
      while (statement.step()) {
        let row = statement.row;
        messages.push({ sourceTitle: row.sourceTitle,
                        subject: row.subject,
                        author: row.author,
                        link: row.link,
                        timestamp: row.timestamp,
                        content: row.content });
      }
    }
    finally {
      statement.reset();
    }

    return messages;
  },

  onLoad: function() {
    let messages = this._selectMessages();

    for each (let message in messages) {
      let entry = new String(ENTRY_TEMPLATE);

      for (let [name, value] in Iterator(message)) {
        if (name == "content")
          value = escapeXML(value);
        else if (name == "timestamp")
          value = new Date(value).toLocaleString();
        else if (name == "author")
          value = escapeXML(value);

        entry = entry.replace("@@" + name + "@@", value, "g");
      }

      let container = document.createElementNS(HTML_NS, "div");
      document.getElementById("content").appendChild(container);
      container.innerHTML = entry;
    }
  }
};
