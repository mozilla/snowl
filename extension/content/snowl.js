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

  // Atom Service
  get _atomSvc() {
    let atomSvc = Cc["@mozilla.org/atom-service;1"].
                  getService(Ci.nsIAtomService);
    delete this._atomSvc;
    this._atomSvc = atomSvc;
    return this._atomSvc;
  },

  // The ID of the source to display.  The sidebar can set this to the source
  // selected by the user.
  // FIXME: make this an array of sources, and let the user select multiple
  // sources to view multiple sources simultaneously.
  sourceID: null,

  get _filter() {
    delete this._filter;
    return this._filter = document.getElementById("snowlFilter");
  },

  get _tree() {
    delete this._tree;
    return this._tree = document.getElementById("snowlView");
  },


  //**************************************************************************//
  // nsITreeView

  get rowCount() {
    this._log.info("get rowCount: " + this._model.length);
    return this._model.length;
  },

  getCellText: function(aRow, aColumn) {
    switch(aColumn.id) {
      case "snowlAuthorCol":
        return this._model[aRow].author;
      case "snowlSubjectCol":
        return this._model[aRow].subject;
      case "snowlTimestampCol":
        return this._formatTimestamp(new Date(this._model[aRow].timestamp));
      default:
        return null;
    }
  },

  _treebox: null,
  setTree: function(treebox){ this._treebox = treebox; },

  isContainer: function(aRow) { return false },
  isSeparator: function(aRow) { return false },
  isSorted: function() { return false },
  getLevel: function(aRow) { return 0 },
  getImageSrc: function(aRow, aColumn) { return null },
  getRowProperties: function (aRow, aProperties) {},

  getCellProperties: function (aRow, aColumn, aProperties) {
    // We have to set this on each cell rather than on the row as a whole
    // because the styling we apply to unread messages (bold text) has to be
    // specified by the ::-moz-tree-cell-text pseudo-element, which inherits
    // only the cell's properties.
    if (!this._model[aRow].read)
      aProperties.AppendElement(this._atomSvc.getAtom("unread"));
  },

  getColumnProperties: function(aColumnID, aColumn, aProperties) {},

  // We could implement inline tagging with an editable "Tags" column
  // by making this true, adding editable="true" to the tree tag, and
  // then marking only the tags column as editable.
  isEditable: function() { return false },


  //**************************************************************************//
  // Model Generation

  // A JavaScript data structure storing the data that appears in the view.
  //
  // Another way of doing this would be to select the data into a temporary
  // table or view (either in the normal database or in the in-memory database).
  // I'm not sure which approach is more memory-efficient or faster.
  //
  // Also, it's inaccurate to call this the model, since the model is really
  // the database itself.  This is rather a view on the model, but I can't think
  // of a good name for that.
  _model: null,

  _rebuildModel: function() {
    let conditions = [];

    // Step one: generate the query string.

    // FIXME: use a left join here again like we used to do before we hit
    // the bug with left joins to virtual tables that has been fixed
    // with the upgrade to 3.5.8 on April 17.
    if (this._filter.value)
      conditions.push("messages.id IN (SELECT messageID FROM parts WHERE content MATCH :filter)");

    if (this.sourceID)
      conditions.push("sourceID = :sourceID");

    let statementString = 
      //"SELECT sources.title AS sourceTitle, subject, author, link, timestamp, content \
      // FROM sources JOIN messages ON sources.id = messages.sourceID \
      // LEFT JOIN parts on messages.id = parts.messageID";
      "SELECT sources.title AS sourceTitle, messages.id AS id, " +
             "subject, author, link, timestamp, read " +
      "FROM sources JOIN messages ON sources.id = messages.sourceID";

    if (conditions.length > 0)
      statementString += " WHERE " + conditions.join(" AND ");

    // FIXME: figure out the sort on the tree and use the same sort here
    // if doing so is cheaper than retrieving the elements unsorted and letting
    // the tree sorter handle sorting.
    statementString += " ORDER BY timestamp DESC";


    // Step two: create the statement and bind parameters to it.

    let statement = SnowlDatastore.createStatement(statementString);

    if (this._filter.value)
      statement.params.filter = this._filter.value;

    if (this.sourceID)
      statement.params.sourceID = this.sourceID;


    // Step three: execute the query and retrieve its results.
    this._model = [];
    try {
      while (statement.step()) {
        this._model.push({ id:          statement.row.id,
                           sourceTitle: statement.row.sourceTitle,
                           subject:     statement.row.subject,
                           author:      statement.row.author,
                           link:        statement.row.link,
                           timestamp:   statement.row.timestamp,
                           read:        (statement.row.read ? true : false)
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
  },


  //**************************************************************************//
  // Initialization and Destruction

  init: function() {
    this._log = Log4Moz.Service.getLogger("Snowl.View");
    this._obsSvc.addObserver(this, "messages:changed", true);
    this._rebuildModel();
    this._tree.view = this;
  },

  destroy: function() {
    this._obsSvc.removeObserver(this, "messages:changed");
  },


  //**************************************************************************//
  // Misc XPCOM Interfaces

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
        this._onMessagesChanged();
        break;
    }
  },


  //**************************************************************************//
  // Event & Notification Handling

  _onMessagesChanged: function() {
    this._rebuildModel();
    this._tree.boxObject.invalidate();
  },

  onFilter: function() {
    this._rebuildModel();
    this._tree.boxObject.invalidate();
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
    if (this._tree.currentIndex == -1)
      return;

    // When we support opening multiple links in the background,
    // perhaps use this code:
    // http://lxr.mozilla.org/mozilla/source/browser/base/content/browser.js#1482

    let row = this._tree.currentIndex;
    let message = this._model[row];

    window.loadURI(message.link, null, null, false);
    this._setRead(true);
  },

  onKeyPress: function(aEvent) {
    if (aEvent.altKey || aEvent.metaKey || aEvent.ctrlKey)
      return;

    // which is either the charCode or the keyCode, depending on which is set.
    this._log.info("onKeyPress: which = " + aEvent.which);

    if (aEvent.charCode == "r".charCodeAt(0))
      this._toggleRead();
    else if (aEvent.charCode == " ".charCodeAt(0))
      this._onSpacePress(aEvent);
  },

  // Based on SpaceHit in mailWindowOverlay.js
  _onSpacePress: function(aEvent) {
    if (aEvent.shiftKey) {
      // if at the start of the message, go to the previous one
      if (gBrowser.contentWindow.scrollY > 0)
        gBrowser.contentWindow.scrollByPages(-1);
      else
        this._goToPreviousUnreadMessage();
    }
    else {
      // if at the end of the message, go to the next one
      if (gBrowser.contentWindow.scrollY < gBrowser.contentWindow.scrollMaxY)
        gBrowser.contentWindow.scrollByPages(1);
      else
        this._goToNextUnreadMessage();
    }
  },

  _goToPreviousUnreadMessage: function() {
    let currentIndex = this._tree.currentIndex;
    let i = currentIndex - 1;

    while (i != currentIndex) {
      if (i < 0) {
        i = this._model.length - 1;
        continue;
      }

      if (!this._model[i].read) {
        this.selection.select(i);
        this._tree.treeBoxObject.ensureRowIsVisible(i);
        break;
      }

      i--;
    }
  },

  _goToNextUnreadMessage: function() {
    let currentIndex = this._tree.currentIndex;
    let i = currentIndex + 1;

    while (i != currentIndex) {
      if (i > this._model.length - 1) {
        i = 0;
        continue;
      }
this._log.info(i);
      if (!this._model[i].read) {
        this.selection.select(i);
        this._tree.treeBoxObject.ensureRowIsVisible(i);
        break;
      }

      i++;
    }
  },

  _toggleRead: function() {
this._log.info("_toggleRead");
    if (this._tree.currentIndex == -1)
      return;

    let row = this._tree.currentIndex;
    let message = this._model[row];
    this._setRead(!message.read);
  },

  _setRead: function(aRead) {
    let row = this._tree.currentIndex;
    let message = this._model[row];

    message.read = aRead;
try {
    SnowlDatastore.dbConnection.executeSimpleSQL("UPDATE messages SET read = " +
                                                 (aRead ? "1" : "0") +
                                                 " WHERE id = " + message.id);
}
catch(ex) {
this._log.error(SnowlDatastore.dbConnection.lastErrorString);
throw ex;
}
    this._tree.boxObject.invalidateRow(row);
  },

  setSource: function(aSourceID) {
    this.sourceID = aSourceID;
    this._rebuildModel();
    this._tree.boxObject.invalidate();
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
