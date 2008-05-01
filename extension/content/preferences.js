const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/datastore.js");

let SnowlPreferences = {
  onImportOPML: function() {
    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window, "Import", Ci.nsIFilePicker.modeOpen);
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

    SnowlService.refreshStaleSources();
  },

  _importOutline: function(aOutline) {
    // If this outline represents a feed, subscribe the user to the feed.
    var url = aOutline.getAttribute("xmlUrl");
    if (url) {
      // FIXME: make sure the user isn't already subscribed to the feed
      // before subscribing them.
      let title = aOutline.getAttribute("title") || aOutline.getAttribute("text") || "untitled";
      this._importItem(url, title);
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

  _importItem: function(aURL, aTitle) {
    // FIXME: create the statement once and then reuse it each time.
    let statement = SnowlDatastore.createStatement("INSERT INTO sources (url, title) VALUES (:url, :title)");
    try {
      statement.params.url = aURL;
      statement.params.title = aTitle;
      statement.step();
    }
    finally {
      statement.reset();
    }
  }
};
