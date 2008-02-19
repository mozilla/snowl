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
  _selectMessages: function(aMatchWords) {
    netscape.security.PrivilegeManager.enablePrivilege("UniversalXPConnect");

    let conditions = [];

    if (aMatchWords)
      conditions.push("messages.id IN (SELECT messageID FROM parts WHERE content MATCH :matchWords)");

    let statementString = 
      "SELECT sources.title AS sourceTitle, subject, author, link, timestamp, content \
       FROM sources JOIN messages ON sources.id = messages.sourceID \
       JOIN parts on messages.id = parts.messageID";

    if (conditions.length > 0)
      statementString += " WHERE " + conditions.join(" AND ");

    statementString += " ORDER BY timestamp DESC";

    let statement = SnowlDatastore.createStatement(statementString);

    if (aMatchWords)
      statement.params.matchWords = aMatchWords;

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
    catch(ex) {
      dump(statementString + ": " + ex + ": " + SnowlDatastore.dbConnection.lastErrorString + "\n");
      throw ex;
    }
    finally {
      statement.reset();
    }

    return messages;
  },

  onLoad: function() {
    this._rebuildView();
  },
  
  onFilter: function() {
    let filterTextbox = document.getElementById("filterTextbox");
    this._rebuildView(filterTextbox.value);
  },

  _rebuildView: function(aMatchWords) {
    let rootNode = document.getElementById("content");
    while (rootNode.hasChildNodes())
      rootNode.removeChild(rootNode.lastChild);

    let messages = this._selectMessages(aMatchWords);

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
      rootNode.appendChild(container);
      container.innerHTML = entry;
    }
  }
};
