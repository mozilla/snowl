var Snowl = {
  _log: null,

  init: function() {
    this._service = SnowlService;

    this._initModules();

    this._log = Log4Moz.Service.getLogger("Snowl.Controller");

    //SnowlFeedClient.refresh("http://www.melez.com/mykzilla/atom.xml");
    
    SnowlView.onLoad();
  },

  _initModules: function() {
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
