if (typeof Cc == "undefined") Cc = Components.classes;
if (typeof Ci == "undefined") Ci = Components.interfaces;
if (typeof Cr == "undefined") Cr = Components.results;
if (typeof Cu == "undefined") Cu = Components.utils;

var Snowl = {
  init: function() {
    this._initModules();
    //SnowlFeedClient.refresh("http://www.melez.com/mykzilla/atom.xml");
  },

  _initModules: function() {
    let ioSvc = Cc["@mozilla.org/network/io-service;1"].
                getService(Ci.nsIIOService);
    
    let resProt = ioSvc.getProtocolHandler("resource").
                  QueryInterface(Ci.nsIResProtocolHandler);
    
    if (!resProt.hasSubstitution("snowl")) {
      let extMgr = Cc["@mozilla.org/extensions/manager;1"].
                   getService(Ci.nsIExtensionManager);
      let loc = extMgr.getInstallLocation("snowl@mozilla.org");
      let extD = loc.getItemLocation("snowl@mozilla.org");
      extD.append("modules");
      resProt.setSubstitution("snowl", ioSvc.newFileURI(extD));
    }
    
    Cu.import("resource://snowl/datastore.js");
  },

  getNewMessages: function() {
    let sources = this.getSources();
    for each (let source in sources)
      source.getNewMessages();
  },

  getSources: function() {
    let sources = [];

    let rows = SnowlDatastore.selectSources();

    for each (let row in rows)
      sources.push(new SnowlFeed(row.id, row.url, row.title));

    return sources;
  },

  /**
   * Determine whether or not the datastore contains the message with the given ID.
   *
   * @param aUniversalID {string}  the universal ID of the message
   *
   * @returns {boolean} whether or not the datastore contains the message
   */
  hasMessage: function(aUniversalID) {
    return SnowlDatastore.selectHasMessage(aUniversalID);
  },

  /**
   * Add a message with a single part to the datastore.
   *
   * @param aSourceID    {integer} the record ID of the message source
   * @param aUniversalID {string}  the universal ID of the message
   * @param aSubject     {string}  the title of the message
   * @param aAuthor      {string}  the author of the message
   * @param aTimestamp   {Date}    the date/time at which the message was sent
   * @param aLink        {nsIURI}  a link to the content of the message,
   *                               if the content is hosted on a server
   * @param aContent     {string}  the content of the message, if the content
   *                               is included with the message
   * @param aContentType {string}  the media type of the content of the message,
   *                               if the content is included with the message
   *
   * FIXME: allow callers to pass a set of arbitrary metadata name/value pairs
   * that get written to the attributes table.
   * 
   * @returns {integer} the internal ID of the newly-created message
   */
  addSimpleMessage: function(aSourceID, aUniversalID, aSubject, aAuthor,
                             aTimestamp, aLink, aContent, aContentType) {
    // Convert the timestamp to milliseconds-since-epoch, which is how we store
    // it in the datastore.
    let timestamp = aTimestamp ? aTimestamp.getTime() : null;

    // Convert the link to its string spec, which is how we store it
    // in the datastore.
    let link = aLink ? aLink.spec : null;

    let messageID =
      SnowlDatastore.insertMessage(aSourceID, aUniversalID, aSubject, aAuthor,
                                   timestamp, link);

    if (aContent)
      SnowlDatastore.insertPart(messageID, aContent, aContentType);

    return messageID;
  },

  addMetadatum: function(aMessageID, aAttributeName, aValue) {
    // FIXME: speed this up by caching the list of known attributes.
    let attributeID = SnowlDatastore.selectAttributeID(aAttributeName)
                      || SnowlDatastore.insertAttribute(aAttributeName);
    SnowlDatastore.insertMetadatum(aMessageID, attributeID, aValue);
  }
};

window.addEventListener("load", function() { Snowl.init() }, false);
