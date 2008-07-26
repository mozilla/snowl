Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/URI.js");
Cu.import("resource://snowl/modules/identity.js");
Cu.import("resource://snowl/modules/collection.js");

// FIXME: make this configurable.
const SNOWL_COLLECTIONS_HIERARCHICAL = false;

let SourcesView = {
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
    delete this._tree;
    return this._tree = document.getElementById("sourcesView");
  },

  get _children() {
    delete this._children;
    return this._children = this._tree.getElementsByTagName("treechildren")[0];
  },


  //**************************************************************************//
  // Initialization & Destruction

  init: function() {
    this._log = Log4Moz.Service.getLogger("Snowl.Sidebar");
    this._obsSvc.addObserver(this, "sources:changed", true);
    this._getCollections();
    this._tree.view = this;

    // Add a capturing click listener to the tree so we can find out if the user
    // clicked on a row that is already selected (in which case we let them edit
    // the collection name).
    // FIXME: disable this for names that can't be changed.
    this._tree.addEventListener("mousedown", function(aEvent) { SourcesView.onClick(aEvent) }, true);
  },


  //**************************************************************************//
  // nsITreeView

  selection: null,

  get rowCount() {
    return this._rows.length;
  },

  // FIXME: consolidate these two references.
  _treebox: null,
  setTree: function(treeBox) {
    this._treeBox = treeBox;
  },

  getCellText : function(row, column) {
    return this._rows[row].name;
  },

  isContainer: function(row) {
    //this._log.info("isContainer: " + (this._rows[row].groups ? true : false));
    return (this._rows[row].groups ? true : false);
  },
  isContainerOpen: function(row) {
    //this._log.info("isContainerOpen: " + this._rows[row].isOpen);
    return this._rows[row].isOpen;
  },
  isContainerEmpty: function(row) {
    //this._log.info("isContainerEmpty: " + row + " " + this._rows[row].groups.length + " " + (this._rows[row].groups.length == 0));
    return (this._rows[row].groups.length == 0);
  },

  isSeparator: function(row)         { return false },
  isSorted: function()               { return false },

  // FIXME: make this return true for collection names that are editable,
  // and then implement name editing on the new architecture.
  isEditable: function(row, column)  { return false },

  getParentIndex: function(row) {
    //this._log.info("getParentIndex: " + row);

    let thisLevel = this.getLevel(row);

    if (thisLevel == 0)
      return -1;
    for (let t = row - 1; t >= 0; t--)
      if (this.getLevel(t) < thisLevel)
        return t;

    throw "getParentIndex: couldn't figure out parent index for row " + row;
  },

  getLevel: function(row) {
    //this._log.info("getLevel: " + row);

    if (!SNOWL_COLLECTIONS_HIERARCHICAL)
      return 0;

    return this._rows[row].level;
  },

  hasNextSibling: function(idx, after) {
    //this._log.info("hasNextSibling: " + idx + " " + after);

    let thisLevel = this.getLevel(idx);
    for (let t = idx + 1; t < this._rows.length; t++) {
      let nextLevel = this.getLevel(t);
      if (nextLevel == thisLevel)
        return true;
      if (nextLevel < thisLevel)
        return false;
    }

    return false;
  },

  getImageSrc: function(row, column) {
    if (column.id == "nameCol") {
      let faviconURI = this._rows[row].faviconURI;
      if (faviconURI)
        return faviconURI.spec;
    }

    return null;
  },

  toggleOpenState: function(idx) {
    //this._log.info("toggleOpenState: " + idx);

    let item = this._rows[idx];
    if (!item.groups)
      return;

    if (item.isOpen) {
      item.isOpen = false;

      let thisLevel = this.getLevel(idx);
      let numToDelete = 0;
      for (let t = idx + 1; t < this._rows.length; t++) {
        if (this.getLevel(t) > thisLevel)
          numToDelete++;
        else
          break;
      }
      if (numToDelete) {
        this._rows.splice(idx + 1, numToDelete);
        this._treeBox.rowCountChanged(idx + 1, -numToDelete);
      }
    }
    else {
      item.isOpen = true;

      let groups = this._rows[idx].groups;
      for (let i = 0; i < groups.length; i++)
        this._rows.splice(idx + 1 + i, 0, groups[i]);
      this._treeBox.rowCountChanged(idx + 1, groups.length);
    }
  },

  getRowProperties: function (aRow, aProperties) {},
  getCellProperties: function (aRow, aColumn, aProperties) {},
  getColumnProperties: function(aColumnID, aColumn, aProperties) {},

  setCellText: function(aRow, aCol, aValue) {
    let statement = SnowlDatastore.createStatement("UPDATE sources SET name = :name WHERE id = :id");
    statement.params.name = this._rows[aRow].name = aValue;
    statement.params.id = this._rows[aRow].id;

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
        this._getCollections();
        // Rebuild the view to reflect the new collection of messages.
        // Since the number of rows might have changed, we do this by reinitializing
        // the view instead of merely invalidating the box object (which doesn't
        // expect changes to the number of rows).
        this._tree.view = this;
        break;
    }
  },

  _collections: null,
  _getCollections: function() {
    this._collections = [];

    let all = new SnowlCollection();
    all.name = "All";
    all.defaultFaviconURI = URI.get("chrome://snowl/content/icons/rainbow.png");
    this._collections.push(all);

    let grouping = {
      nameColumn: "sources.name",
      uriColumn: "sources.humanURI",
      // the default favicon for sources
      // FIXME: use a source type-specific favicon.
      defaultFaviconURI: URI.get("chrome://browser/skin/feeds/feedIcon16.png")
    }
    let collection = new SnowlCollection(null, null, grouping);
    collection.name = "Sources";
    this._collections.push(collection);

    {
      let grouping = {
        nameColumn: "authors.name"
        // FIXME: get a favicon for people
      }
      let collection = new SnowlCollection(null, null, grouping);
      collection.name = "People";
      this._collections.push(collection);
    }

    // Build the list of rows in the tree.  By default, all containers
    // are closed, so this is the same as the list of collections, although
    // in the future we might persist and restore the open state.
    // XXX Should this work be in a separate function?
    if (SNOWL_COLLECTIONS_HIERARCHICAL) {
      this._rows = [collection for each (collection in this._collections)];
    }
    else {
      this._rows = [];
      for each (let collection in this._collections) {
        if (collection.groups)
          for each (let group in collection.groups)
            this._rows.push(group);
        else
          this._rows.push(collection);
      }
    }
  },

  onSelect: function(aEvent) {
    if (this._tree.currentIndex == -1)
      return;

    let collection = this._rows[this._tree.currentIndex];
    gMessageViewWindow.SnowlMessageView.setCollection(collection);
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
    let sourceID = this._collections[this._tree.currentIndex].id;

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

// We can't listen for load and initialize then because load has already
// happened when we get overlaid onto the river view, so we just set a timeout
// by which time we hope the overlay has been loaded enough for this to work.
// FIXME: figure out a better solution here.  In theory we should be able
// to make the river view observe xul-overlay-merged and then initialize us,
// but that doesn't work because of bug 392515.
window.setTimeout(function() { SourcesView.init() }, 100);
