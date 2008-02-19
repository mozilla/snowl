var Snowl = {
  log: null,

  init: function() {
    this._service = new SnowlService();

    this._initModules();

    this.log = Log4Moz.Service.getLogger("Snowl.Controller");
    this.log.warn("foo");

    //SnowlFeedClient.refresh("http://www.melez.com/mykzilla/atom.xml");
    
    SnowlView.onLoad();
  },

  _initModules: function() {
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

  toggleView: function() {
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
  },

  /**
   * Reset the last refreshed time for the given source to the current time.
   *
   * XXX should this be setLastRefreshed and take a time parameter
   * to set the last refreshed time to?
   *
   * aSource {SnowlMessageSource} the source for which to set the time
   */
  resetLastRefreshed: function(aSource) {
    let stmt = SnowlDatastore.createStatement("UPDATE sources SET lastRefreshed = :lastRefreshed WHERE id = :id");
    stmt.params.lastRefreshed = new Date().getTime();
    stmt.params.id = aSource.id;
    stmt.execute();
  }
};

window.addEventListener("load", function() { Snowl.init() }, false);
