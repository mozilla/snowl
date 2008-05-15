const EXPORTED_SYMBOLS = ["SnowlSource"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/URI.js");

function SnowlSource(aID, aName, aMachineURI, aHumanURI, aLastRefreshed, aImportance) {
  this.id = aID;
  this.name = aName;
  this.machineURI = aMachineURI;
  this.humanURI = aHumanURI;
  this.lastRefreshed = aLastRefreshed;
  this.importance = aImportance;
}

SnowlSource.__defineGetter__("_getStatement",
  function() {
    let statement = SnowlDatastore.createStatement(
      "SELECT name, machineURI, humanURI, lastRefreshed, importance " +
      "FROM sources WHERE id = :id"
    );
    this.__defineGetter__("_getStatement", function() { return statement });
    return this._getStatement;
  }
);

/**
 * Get the SnowlSource identified by the given identifier.
 *
 * FIXME: cache instances and return the cached instance if available.
 */
SnowlSource.get = function(aID) {
  try {
    this._getStatement.params.id = aID;
    if (this._getStatement.step())
      return new SnowlSource(aID,
                             this._getStatement.row.name,
                             URI.get(this._getStatement.row.machineURI),
                             URI.get(this._getStatement.row.humanURI),
                             new Date(this._getStatement.row.lastRefreshed),
                             this._getStatement.row.importance);
  }
  finally {
    this._getStatement.reset();
  }

  return null;
}

SnowlSource.prototype = {
  id: null,

  name: null,

  // The URL at which to find a machine-processable representation of the data
  // provided by the source.  For a feed source, this is the URL of its RSS/Atom
  // document; for an email source, it's the URL of its POP/IMAP server.
  machineURI: null,

  // The URL at which to find a human-readable representation of the data
  // provided by the source.  For a feed source, this is the website that
  // publishes the feed; for an email source, it might be the webmail interface.
  humanURI: null,

  // A JavaScript Date object representing the last time this source
  // was checked for updates to its set of messages.
  lastRefreshed: null,

  // An integer representing how important this source is to the user
  // relative to other sources to which the user is subscribed.
  importance: null
};
