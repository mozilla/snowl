const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://snowl/service.js");
Cu.import("resource://snowl/datastore.js");
Cu.import("resource://snowl/log4moz.js");

var gBrowserWindow = window.QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIWebNavigation).
                     QueryInterface(Ci.nsIDocShellTreeItem).
                     rootTreeItem.
                     QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIDOMWindow);

SourcesView = {
  _log: null,

  // Observer Service
  get _obsSvc() {
    let obsSvc = Cc["@mozilla.org/observer-service;1"].
                 getService(Ci.nsIObserverService);
    delete this._obsSvc;
    this._obsSvc = obsSvc;
    return this._obsSvc;
  },

  get _tree() {
    let tree = document.getElementById("sourcesView");
    delete this._tree;
    this._tree = tree;
    return this._tree;
  },

  get _children() {
    let children = this._tree.getElementsByTagName("treechildren")[0];
    delete this._children;
    this._children = children;
    return this._children;
  },

  init: function() {
    this._log = Log4Moz.Service.getLogger("Snowl.Sidebar");
    this._obsSvc.addObserver(this, "sources:changed", true);
    this._rebuildModel();
    this._tree.view = this;

    // Add a capturing click listener to the tree so we can find out if the user
    // clicked on a row that is already selected (in which case we let them edit
    // the source name).
    this._tree.addEventListener("mousedown", function(aEvent) { SourcesView.onClick(aEvent) }, true);
  },


  //**************************************************************************//
  // nsITreeView

  rowCount: 0,
  getCellText : function(row,column){
    if (column.id == "nameCol") return this._model[row].title;
    return "foo";
  },

  _treebox: null,
  setTree: function(treebox){ this._treebox = treebox; },

  isContainer: function(aRow) { return false },
  isSeparator: function(aRow) { return false },
  isSorted: function() { return false },
  getLevel: function(aRow) { return 0 },
  getImageSrc: function(aRow, aColumn) { return null },
  getRowProperties: function (aRow, aProperties) {},
  getCellProperties: function (aRow, aColumn, aProperties) {},
  getColumnProperties: function(aColumnID, aColumn, aProperties) {},
  isEditable: function() {
    return true;
  },

  setCellText: function(aRow, aCol, aValue) {
    let statement = SnowlDatastore.createStatement("UPDATE sources SET title = :title WHERE id = :id");
    statement.params.title = this._model[aRow].title = aValue;
    statement.params.id = this._model[aRow].id;

    try {
      statement.execute();
    }
    finally {
      statement.reset();
    }
  },


  //**************************************************************************//
  // Misc XPCOM Interface Implementations

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
      case "sources:changed":
        this._rebuildModel();
        this._tree.boxObject.invalidate();
        break;
    }
  },

  _model: null,
  _rebuildModel: function() {
    let statementString = "SELECT title, id FROM sources ORDER BY title";
    let statement = SnowlDatastore.createStatement(statementString);

    this._model = [];

    let i = 0;
    this._model[i] = { id: null, title: "All" };

    try {
      while (statement.step())
        this._model[++i] = { id: statement.row.id, title: statement.row.title };
    }
    finally {
      statement.reset();
    }

    this.rowCount = i + 1;
  },

  onSelect: function(aEvent) {
this._log.info("on select");
//this._log.info(Log4Moz.enumerateProperties(aEvent).join("\n"));
    if (this._tree.currentIndex == -1)
      return;
    
    let sourceID = this._model[this._tree.currentIndex].id;
    gBrowserWindow.SnowlView.setSource(sourceID);
  },

  onClick: function(aEvent) {
this._log.info("on click");
//this._log.info(Log4Moz.enumerateProperties(aEvent).join("\n"));
//this._log.info(aEvent.target.nodeName);

  let row = {}, col = {}, child = {};
  this._tree.treeBoxObject.getCellAt(aEvent.clientX, aEvent.clientY, row, col, child);
  if (this._tree.view.selection.isSelected(row.value))
this._log.info(row.value + " is selected");
else
this._log.info(row.value + " is not selected");
  },

  onUnsubscribe: function(aEvent) {
    let sourceID = this._model[this._tree.currentIndex].id;

    SnowlDatastore.dbConnection.beginTransaction();
    try {
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM metadata WHERE messageID IN (SELECT id FROM messages WHERE sourceID = " + sourceID + ")");
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM parts WHERE messageID IN (SELECT id FROM messages WHERE sourceID = " + sourceID + ")");
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM messages WHERE sourceID = " + sourceID);
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM sources WHERE id = " + sourceID);
      SnowlDatastore.dbConnection.commitTransaction();
    }
    catch(ex) {
      SnowlDatastore.dbConnection.rollbackTransaction();
      throw ex;
    }

    this._obsSvc.notifyObservers(null, "sources:changed", null);
    this._obsSvc.notifyObservers(null, "messages:changed", null);
  }

};

window.addEventListener("load", function() { SourcesView.init() }, false);
