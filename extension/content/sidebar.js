const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/URI.js");

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

  get _subscribePanel() {
    let subscribePanel = document.getElementById("snowlSubscribePanel");
    delete this._subscribePanel;
    this._subscribePanel = subscribePanel;
    return this._subscribePanel;
  },


  //**************************************************************************//
  // Initialization & Destruction

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
  // Event Handlers

  onCommandImportOPMLButton: function() {
    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window, "Import OPML", Ci.nsIFilePicker.modeOpen);
    fp.appendFilter("OPML Files", "*.opml");
    fp.appendFilters(Ci.nsIFilePicker.filterXML);
    fp.appendFilters(Ci.nsIFilePicker.filterAll);

    let rv = fp.show();
    if (rv != Ci.nsIFilePicker.returnOK)
      return;

    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
                  createInstance(Ci.nsIXMLHttpRequest);
    request.open("GET", fp.fileURL.spec, false);
    // Since the file probably ends in .opml, we have to force XHR to treat it
    // as XML by overriding the MIME type it would otherwise select.
    request.overrideMimeType("text/xml");
    request.send(null);
    let xmlDocument = request.responseXML;

    let outline = xmlDocument.getElementsByTagName("body")[0];

    this._importOutline(outline);
  },

  onCommandCancelButton: function() {
    this._subscribePanel.hidePopup();
  },


  //**************************************************************************//
  // OPML Import

  _importOutline: function(aOutline) {
    // If this outline represents a feed, subscribe the user to the feed.
    let uri = URI.get(aOutline.getAttribute("xmlUrl"));
    if (uri) {
      // FIXME: make sure the user isn't already subscribed to the feed
      // before subscribing her to it.
      let name = aOutline.getAttribute("title") || aOutline.getAttribute("text") || "untitled";
      new SnowlFeed(null, name, uri).subscribe();
    }

    if (aOutline.hasChildNodes()) {
      let children = aOutline.childNodes;
      for (let i = 0; i < children.length; i++) {
        let child = children[i];

        // Only deal with "outline" elements; ignore text, etc. nodes.
        if (child.nodeName != "outline")
          continue;

        this._importOutline(child);
      }
    }
  },


  //**************************************************************************//
  // nsITreeView

  get rowCount() {
    return this._model.length;
  },

  getCellText : function(aRow, aColumn) {
    if (aColumn.id == "nameCol")
      return this._model[aRow].name;
    return null;
  },

  _treebox: null,
  setTree: function(treebox){ this._treebox = treebox; },

  isContainer: function(aRow) { return false },
  isSeparator: function(aRow) { return false },
  isSorted: function() { return false },
  getLevel: function(aRow) { return 0 },

  getImageSrc: function(aRow, aColumn) {
    if (aColumn.id == "nameCol")
      return this._model[aRow].faviconURI.spec;
    return null;
  },

  getRowProperties: function (aRow, aProperties) {},
  getCellProperties: function (aRow, aColumn, aProperties) {},
  getColumnProperties: function(aColumnID, aColumn, aProperties) {},
  isEditable: function() {
    return true;
  },

  setCellText: function(aRow, aCol, aValue) {
    let statement = SnowlDatastore.createStatement("UPDATE sources SET name = :name WHERE id = :id");
    statement.params.name = this._model[aRow].name = aValue;
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
        // Rebuild the view to reflect the new collection of messages.
        // Since the number of rows might have changed, we do this by reinitializing
        // the view instead of merely invalidating the box object (which doesn't
        // expect changes to the number of rows).
        this._tree.view = this;
        break;
    }
  },

  _model: null,
  _rebuildModel: function() {
    this._model = SnowlSource.getAll();
    this._model.unshift({ id: null,
                          name: "All",
                          faviconURI: URI.get("chrome://snowl/content/icons/rainbow.png") });
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
