Cu.import("resource://snowl/service.js");
Cu.import("resource://snowl/datastore.js");
Cu.import("resource://snowl/log4moz.js");

let SnowlView = {
  _log: null,

  // Observer Service
  get _obsSvc() {
    let obsSvc = Cc["@mozilla.org/observer-service;1"].
                 getService(Ci.nsIObserverService);
    delete this._obsSvc;
    this._obsSvc = obsSvc;
    return this._obsSvc;
  },

  // Date Formatting Service
  get _dfSvc() {
    let dfSvc = Cc["@mozilla.org/intl/scriptabledateformat;1"].
                            getService(Ci.nsIScriptableDateFormat);
    delete this._dfSvc;
    this._dfSvc = dfSvc;
    return this._dfSvc;
  },

  sourceID: null,

  _getMessages: function(aMatchWords) {
    let conditions = [];

    if (aMatchWords)
      conditions.push("messages.id IN (SELECT messageID FROM parts WHERE content MATCH :matchWords)");

    if (this.sourceID != null)
      conditions.push("sourceID = :sourceID");

    let statementString = 
      //"SELECT sources.title AS sourceTitle, subject, author, link, timestamp, content \
      // FROM sources JOIN messages ON sources.id = messages.sourceID \
      // LEFT JOIN parts on messages.id = parts.messageID";
      "SELECT sources.title AS sourceTitle, subject, author, link, timestamp \
       FROM sources JOIN messages ON sources.id = messages.sourceID";

    if (conditions.length > 0)
      statementString += " WHERE " + conditions.join(" AND ");

    statementString += " ORDER BY timestamp DESC";

    //this._log.info("getMessages: statementString = " + statementString);

    let statement = SnowlDatastore.createStatement(statementString);

    if (aMatchWords) {
      this._log.info("getMessages: aMatchWords = " + aMatchWords);
      statement.params.matchWords = aMatchWords;
    }

    if (this.sourceID != null) {
      this._log.info("getMessages: sourceID = " + this.sourceID);
      statement.params.sourceID = this.sourceID;
    }

    let messages = [];
    try {
      while (statement.step()) {
        messages.push({ sourceTitle: statement.row.sourceTitle,
                        subject: statement.row.subject,
                        author: statement.row.author,
                        link: statement.row.link,
                        timestamp: statement.row.timestamp
                        //,content: statement.row.content
                      });
      }
    }
    catch(ex) {
      this._log.error(statementString + ": " + ex + ": " + SnowlDatastore.dbConnection.lastErrorString + "\n");
      throw ex;
    }
    finally {
      statement.reset();
    }

    return messages;
  },

  init: function() {
    this._log = Log4Moz.Service.getLogger("Snowl.View");

try {
    this._obsSvc.addObserver(this, "messages:changed", true);
}
catch(ex) {
  alert(ex);
}
    this._rebuildView();
  },
  
  // nsISupports
  QueryInterface: function(aIID) {
    if (aIID.equals(Ci.nsIObserver) ||
        aIID.equals(Ci.nsISupportsWeakReference) ||
        aIID.equals(Ci.nsISupports))
      return this;
    
    throw Cr.NS_ERROR_NO_INTERFACE;
  },

  // nsIObserver
  observe: function(subject, topic, data) {
    switch (topic) {
      case "messages:changed":
        this._rebuildView();
        break;
    }
  },

  onUpdate: function() {
    this._rebuildView();
  },

  onFilter: function() {
    let filterTextbox = document.getElementById("snowlFilterTextbox");
    this._rebuildView(filterTextbox.value);
  },

  _rebuildView: function(aMatchWords) {
    let tree = document.getElementById("snowlView");
    let children = tree.getElementsByTagName("treechildren")[0];

    // Empty the view.
    while (children.hasChildNodes())
      children.removeChild(children.lastChild);

    // Get the list of messages.
    let messages = this._getMessages(aMatchWords);

    for each (let message in messages) {
      let item = document.createElement("treeitem");
      item.link = message.link;
      let row = document.createElement("treerow");

      let authorCell = document.createElement("treecell");
      authorCell.setAttribute("label", message.author);

      let subjectCell = document.createElement("treecell");
      subjectCell.setAttribute("label", message.subject);

      let timestampCell = document.createElement("treecell");
      let timestamp = new Date(message.timestamp);
      let timestampLabel = this._formatTimestamp(timestamp);
      timestampCell.setAttribute("label", timestampLabel);

      row.appendChild(authorCell);
      row.appendChild(subjectCell);
      row.appendChild(timestampCell);
      item.appendChild(row);
      children.appendChild(item);
    }
  },

  // From toolkit/mozapps/update/content/history.js

  /**
   * Formats a timestamp for human consumption using the date formatting service
   * for locale-specific formatting along with some additional smarts for more
   * human-readable representations of recent timestamps.
   * @param   {Date} the timestamp to format
   * @returns a human-readable string
   */
  _formatTimestamp: function(aTimestamp) {
    let formattedString;

    let now = new Date();

    let yesterday = new Date(now - 24 * 60 * 60 * 1000);
    yesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());

    let sixDaysAgo = new Date(now - 6 * 24 * 60 * 60 * 1000);
    sixDaysAgo = new Date(sixDaysAgo.getFullYear(), sixDaysAgo.getMonth(), sixDaysAgo.getDate());

    if (aTimestamp.toLocaleDateString() == now.toLocaleDateString())
      formattedString = this._dfSvc.FormatTime("",
                                               this._dfSvc.timeFormatNoSeconds,
                                               aTimestamp.getHours(),
                                               aTimestamp.getMinutes(),
                                               null);
    else if (aTimestamp > yesterday)
      formattedString = "Yesterday " + this._dfSvc.FormatTime("",
                                                              this._dfSvc.timeFormatNoSeconds,
                                                              aTimestamp.getHours(),
                                                              aTimestamp.getMinutes(),
                                                              null);
    else if (aTimestamp > sixDaysAgo)
      formattedString = this._dfSvc.FormatDateTime("",
                                                   this._dfSvc.dateFormatWeekday, 
                                                   this._dfSvc.timeFormatNoSeconds,
                                                   aTimestamp.getFullYear(),
                                                   aTimestamp.getMonth() + 1,
                                                   aTimestamp.getDate(),
                                                   aTimestamp.getHours(),
                                                   aTimestamp.getMinutes(),
                                                   aTimestamp.getSeconds());
    else
      formattedString = this._dfSvc.FormatDateTime("",
                                                   this._dfSvc.dateFormatShort, 
                                                   this._dfSvc.timeFormatNoSeconds,
                                                   aTimestamp.getFullYear(),
                                                   aTimestamp.getMonth() + 1,
                                                   aTimestamp.getDate(),
                                                   aTimestamp.getHours(),
                                                   aTimestamp.getMinutes(),
                                                   aTimestamp.getSeconds());

    return formattedString;
  },

  switchPosition: function() {
    let container = document.getElementById("snowlViewContainer");
    let splitter = document.getElementById("snowlViewSplitter");
    let browser = document.getElementById("browser");
    let content = document.getElementById("content");
    let appcontent = document.getElementById("appcontent");

    if (container.parentNode == appcontent) {
      browser.insertBefore(container, appcontent);
      browser.insertBefore(splitter, appcontent);
      splitter.setAttribute("orient", "horizontal");
    }
    else {
      appcontent.insertBefore(container, content);
      appcontent.insertBefore(splitter, content);
      splitter.setAttribute("orient", "vertical");
    }
  },

  onSelect: function(aEvent) {
    let tree = document.getElementById("snowlView");
    if (tree.currentIndex == -1)
      return;

    // When we support opening multiple links in the background,
    // perhaps use this code: http://lxr.mozilla.org/mozilla/source/browser/base/content/browser.js#1482

    let children = tree.getElementsByTagName("treechildren")[0];
    let link = children.childNodes[tree.currentIndex].link;
    window.loadURI(link, null, null, false);
  },

  setSource: function(aSourceID) {
    this.sourceID = aSourceID;
    this._rebuildView();
  },

  toggle: function() {
    let container = document.getElementById("snowlViewContainer");
    let splitter = document.getElementById("snowlViewSplitter");
    if (container.hidden) {
      container.hidden = false;
      splitter.hidden = false;
    }
    else {
      container.hidden = true;
      splitter.hidden = true;
    }
  }
};

window.addEventListener("load", function() { SnowlView.init() }, false);
