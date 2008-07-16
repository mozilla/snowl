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
Cu.import("resource://snowl/modules/identity.js");
Cu.import("resource://snowl/modules/collection.js");

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

  _group: "source",
  onSelectGroup: function(event) {
    this._group = event.target.value;
    gBrowserWindow.SnowlView.setGroup(this._group);
    this._rebuildModel();

    // Rebuild the view to reflect the new collection of messages.
    // Since the number of rows might have changed, we do this by reinitializing
    // the view instead of merely invalidating the box object (which doesn't
    // expect changes to the number of rows).
    this._tree.view = this;
  },

  _model: null,
  _rebuildModel: function() {
/*
    if (this._group == "source")
      this._model = SnowlSource.getAll();
    else if (this._group == "person")
      this._model = SnowlPerson.getAll();
*/
    let foo = new SnowlCollection();
    foo.nameGroupField = "sources.name";
    foo.uriGroupField = "sources.humanURI";
    this._model = foo.groups;

/*
    this._model.unshift({ name: "All",
                          faviconURI: URI.get("chrome://snowl/content/icons/rainbow.png") });
*/
  },

  onSelect: function(aEvent) {
    if (this._tree.currentIndex == -1)
      return;
    
    let id = this._model[this._tree.currentIndex].id;
    gBrowserWindow.SnowlView.setGroupID(id);
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

  subscribe: function(event) {
    gBrowserWindow.gBrowser.selectedTab =
      gBrowserWindow.gBrowser.addTab("chrome://snowl/content/subscribe.xul");
  },

  unsubscribe: function(aEvent) {
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
  },


  //**************************************************************************//
  // OPML Export
  // Based on code in Thunderbird's feed-subscriptions.js

  exportOPML: function() {
    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window, "Export feeds as an OPML file", Ci.nsIFilePicker.modeSave);
    fp.appendFilter("OPML Files", "*.opml");
    fp.appendFilters(Ci.nsIFilePicker.filterXML | Ci.nsIFilePicker.filterAll);
    fp.defaultString = "feeds.opml";
    fp.defaultExtension = "opml";

    let rv = fp.show();

    if (rv == Ci.nsIFilePicker.returnCancel)
      return;

    let doc = this._createOPMLDocument();

    // Format the document with newlines and indentation so it's easier
    // for humans to read.
    this._prettifyNode(doc.documentElement, 0);

    let serializer = new XMLSerializer();
    let foStream = Cc["@mozilla.org/network/file-output-stream;1"].
                   createInstance(Ci.nsIFileOutputStream);
    // default mode:  write | create | truncate
    let mode = 0x02 | 0x08 | 0x20;
    foStream.init(fp.file, mode, 0666, 0);
    serializer.serializeToStream(doc, foStream, "utf-8");
  },

  _createOPMLDocument: function() {
    let doc = document.implementation.createDocument("", "opml", null);
    let root = doc.documentElement;
    root.setAttribute("version", "1.0");

    // Create the <head> element.
    let head = doc.createElement("head");
    root.appendChild(head);

    let title = doc.createElement("title");
    head.appendChild(title);
    title.appendChild(doc.createTextNode("Snowl OPML Export"));

    let dt = doc.createElement("dateCreated");
    head.appendChild(dt);
    dt.appendChild(doc.createTextNode((new Date()).toGMTString()));

    // Create the <body> element.
    let body = doc.createElement("body");
    root.appendChild(body);

    // Populate the <body> element with <outline> elements.
    let sources = SnowlSource.getAll();
    for each (let source in sources) {
      let outline = doc.createElement("outline");
      // XXX Should we specify the |type| attribute, and should we specify
      // type="atom" for Atom feeds or just type="rss" for all feeds?
      // This document says the latter but is three years old:
      // http://www.therssweblog.com/?guid=20051003145153
      //outline.setAttribute("type", "rss");
      outline.setAttribute("text", source.name);
      outline.setAttribute("url", source.humanURI.spec);
      outline.setAttribute("xmlUrl", source.machineURI.spec);
      body.appendChild(outline);
    }

    return doc;
  },

  _prettifyNode: function(node, level) {
    let doc = node.ownerDocument;

    // Create a string containing two spaces for every level deep we are.
    let indentString = new Array(level + 1).join("  ");

    // Indent the tag.
    if (level > 0)
      node.parentNode.insertBefore(doc.createTextNode(indentString), node);

    // Grab the list of nodes to format.  We can't just use node.childNodes
    // because it'd change under us as we insert formatting nodes.
    let childNodesToFormat = [];
    for (let i = 0; i < node.childNodes.length; i++)
      if (node.childNodes[i].nodeType == node.ELEMENT_NODE)
        childNodesToFormat.push(node.childNodes[i]);

    if (childNodesToFormat.length > 0) {
      for each (let childNode in childNodesToFormat)
        this._prettifyNode(childNode, level + 1);

      // Insert a newline after the opening tag.
      node.insertBefore(doc.createTextNode("\n"), node.firstChild);
  
      // Indent the closing tag.
      node.appendChild(doc.createTextNode(indentString));
    }

    // Insert a newline after the tag.
    if (level > 0) {
      if (node.nextSibling)
        node.parentNode.insertBefore(doc.createTextNode("\n"),
                                     node.nextSibling);
      else
        node.parentNode.appendChild(doc.createTextNode("\n"));
    }
  }

};

window.addEventListener("load", function() { SourcesView.init() }, false);
