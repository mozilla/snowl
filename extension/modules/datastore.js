const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

EXPORTED_SYMBOLS = ["SnowlDatastore"];

const TABLE_TYPE_NORMAL = 0;
const TABLE_TYPE_FULLTEXT = 1;

let SnowlDatastore = {
  // FIXME: use the memoization technique for properties that aren't defined
  // in the prototype here instead of the technique for properties that are
  // defined in the prototype.
  get _storage() {
    var storage = Cc["@mozilla.org/storage/service;1"].
                  getService(Ci.mozIStorageService);
    this.__defineGetter__("_storage", function() { return storage });
    return this._storage;
  },

  //**************************************************************************//
  // Database Creation & Access

  _dbVersion: 4,

  _dbSchema: {
    // Note: the timestamp is stored as JavaScript milliseconds since epoch.

    // Note: the universalID is a unique identifier established by the source
    // of the message which remains constant across message transfer points
    // and destinations.  For feeds this is the entry ID; for email messages
    // it's the message ID.

    // FIXME: make the datastore support multiple authors.
    // FIXME: support labeling the subject as HTML or another content type.
    // FIXME: make universalID be called externalID instead.
    // FIXME: index by universalID to make lookups (f.e. when checking if we
    // already have a message) and updates (f.e. when setting current) faster.

    tables: {
      sources: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          // FIXME: rename this 'link'
          "url TEXT NOT NULL",
          // FIXME: rename this "name"
          "title TEXT NOT NULL",
          "lastRefreshed INTEGER",
        ]
      },

      messages: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          "sourceID INTEGER NOT NULL REFERENCES sources(id)",
          "universalID TEXT",
          "subject TEXT",
          "author TEXT",
          "timestamp INTEGER",
          "link TEXT",
          "current BOOLEAN",
          // FIXME: figure out how to make sure read has a default value.
          // Maybe this is as simple as DEFAULT(0) if SQLite supports it.
          "read BOOLEAN"
        ]
      },

      parts: {
        type: TABLE_TYPE_FULLTEXT,
        columns: [
          "messageID INTEGER NOT NULL REFERENCES messages(id)",
          "contentType",
          "content"
        ]
      },

      attributes: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          "namespace TEXT",
          "name TEXT NOT NULL"
        ]
      },

      metadata: {
        type: TABLE_TYPE_FULLTEXT,
        columns: [
          "messageID INTEGER NOT NULL REFERENCES messages(id)",
          "attributeID INTEGER NOT NULL REFERENCES attributes(id)",
          "contentType TEXT NOT NULL",
          "value BLOB"
        ]
      }

    },

    fulltextTables: {
      // FIXME: add "primary" boolean column that identifies the main content
      // for the message (or put that into the messages table?).
      parts:      "id INTEGER PRIMARY KEY, \
                   messageID INTEGER NOT NULL REFERENCES messages(id), \
                   title TEXT, \
                   content BLOB NOT NULL, \
                   contentType TEXT NOT NULL"
    },

    indices: {}
  },

  dbConnection: null,

  createStatement: function(aSQLString) {
dump("createStatement: " + aSQLString + "\n");
    try {
      var statement = this.dbConnection.createStatement(aSQLString);
    }
    catch(ex) {
      Cu.reportError("error creating statement " + aSQLString + ": " +
                     this.dbConnection.lastError + " - " +
                     this.dbConnection.lastErrorString);
      throw ex;
    }

    var wrappedStatement = Cc["@mozilla.org/storage/statement-wrapper;1"].
                           createInstance(Ci.mozIStorageStatementWrapper);
    wrappedStatement.initialize(statement);
    return wrappedStatement;
  },

  // _dbInit, the methods it calls (_dbCreateTables, _dbMigrate), and methods
  // those methods call must be careful not to call any method of the service
  // that assumes the database connection has already been initialized,
  // since it won't be initialized until this function returns.

  _dbInit: function() {
    var dirService = Cc["@mozilla.org/file/directory_service;1"].
                     getService(Ci.nsIProperties);
    var dbFile = dirService.get("ProfD", Ci.nsIFile);
    dbFile.append("messages.sqlite");

    var dbService = Cc["@mozilla.org/storage/service;1"].
                    getService(Ci.mozIStorageService);

    var dbConnection;

    if (!dbFile.exists()) {
      dbConnection = this._dbCreate(dbService, dbFile);
    }
    else {
      try {
        dbConnection = dbService.openUnsharedDatabase(dbFile);

        // Get the version of the database in the file.
        var version = dbConnection.schemaVersion;

        if (version != this._dbVersion)
          this._dbMigrate(dbConnection, version, this._dbVersion);
      }
      catch (ex) {
        // If the database file is corrupted, I'm not sure whether we should
        // just delete the corrupted file or back it up.  For now I'm just
        // deleting it, but here's some code that backs it up (but doesn't limit
        // the number of backups, which is probably necessary, thus I'm not
        // using this code):
        //var backup = this._dbFile.clone();
        //backup.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, PERMS_FILE);
        //backup.remove(false);
        //this._dbFile.moveTo(null, backup.leafName);
        if (ex.result == Cr.NS_ERROR_FILE_CORRUPTED) {
          // Remove the corrupted file, then recreate it.
          dbFile.remove(false);
          dbConnection = this._dbCreate(dbService, dbFile);
        }
        else
          throw ex;
      }
    }

    this.dbConnection = dbConnection;
  },

  _dbCreate: function(aDBService, aDBFile) {
    var dbConnection = aDBService.openUnsharedDatabase(aDBFile);

    dbConnection.beginTransaction();
    try {
      this._dbCreateTables(dbConnection);
      dbConnection.commitTransaction();
    }
    catch(ex) {
      dbConnection.rollbackTransaction();
      throw ex;
    }

    return dbConnection;
  },

  _dbCreateTables: function(aDBConnection) {
    for (var tableName in this._dbSchema.tables) {
      var table = this._dbSchema.tables[tableName];
      switch (table.type) {
        case TABLE_TYPE_FULLTEXT:
          this._dbCreateFulltextTable(aDBConnection, tableName, table.columns);
          break;
        case TABLE_TYPE_NORMAL:
        default:
          aDBConnection.createTable(tableName, table.columns.join(", "));
          break;
      }
    }

    aDBConnection.schemaVersion = this._dbVersion;
  },

  _dbCreateFulltextTable: function(aDBConnection, aTableName, aColumns) {
    aDBConnection.executeSimpleSQL(
      "CREATE VIRTUAL TABLE " + aTableName +
      " USING fts3(" + aColumns.join(", ") + ")"
    );
  },

  _dbMigrate: function(aDBConnection, aOldVersion, aNewVersion) {
    if (this["_dbMigrate" + aOldVersion + "To" + aNewVersion]) {
      aDBConnection.beginTransaction();
      try {
        this["_dbMigrate" + aOldVersion + "To" + aNewVersion](aDBConnection);
        aDBConnection.schemaVersion = aNewVersion;
        aDBConnection.commitTransaction();
      }
      catch(ex) {
        aDBConnection.rollbackTransaction();
        throw ex;
      }
    }
    else
      throw("can't migrate database from v" + aOldVersion +
            " to v" + aNewVersion + ": no migrator function");
  },

  /**
   * Migrate the database schema from version 0 to version 1.  We never create
   * a database with version 0, so the database can only have that version
   * if the database file was created without the schema being constructed.
   * Thus migrating the database is as simple as constructing the schema as if
   * from scratch.
   */
  _dbMigrate0To2: function(aDBConnection) {
    this._dbCreateTables(aDBConnection);
  },

  _dbMigrate2To3: function(aDBConnection) {
    aDBConnection.executeSimpleSQL("ALTER TABLE messages ADD COLUMN current BOOLEAN");
  },

  _dbMigrate3To4: function(aDBConnection) {
    aDBConnection.executeSimpleSQL("ALTER TABLE messages ADD COLUMN read BOOLEAN");
  },

  get _selectSourcesStatement() {
    let statement = this.createStatement(
      "SELECT id, url, title, lastRefreshed FROM sources"
    );
    this.__defineGetter__("_selectSourcesStatement", function() { return statement });
    return this._selectSourcesStatement;
  },

  selectSources: function() {
    let sources = [];

    try {
      while (this._selectSourcesStatement.step()) {
        let row = this._selectSourcesStatement.row;
        sources.push({ id: row.id,
                       url: row.url,
                       title: row.title,
                       lastRefreshed: new Date(row.lastRefreshed)
                     });
      }
    }
    finally {
      this._selectSourcesStatement.reset();
    }

    return sources;
  },

  get _selectSourceIDStatement() {
    let statement = this.createStatement(
      "SELECT id FROM sources WHERE url = :url"
    );
    this.__defineGetter__("_selectSourceIDStatement", function() { return statement });
    return this._selectSourceIDStatement;
  },

  selectSourceID: function(aURL) {
    let id;

    try {
      this._selectSourceIDStatement.params.url = aURL;
      if (this._selectSourceIDStatement.step())
        id = this._selectSourceIDStatement.row["id"];
    }
    finally {
      this._selectSourceIDStatement.reset();
    }

    return id;
  },

  get _selectHasMessageStatement() {
    let statement = this.createStatement(
      "SELECT 1 FROM messages WHERE universalID = :universalID"
    );
    this.__defineGetter__("_selectHasMessageStatement", function() { return statement });
    return this._selectHasMessageStatement;
  },

  selectHasMessage: function(aUniversalID) {
    try {
      this._selectHasMessageStatement.params.universalID = aUniversalID;
      if (this._selectHasMessageStatement.step())
        return true;
    }
    finally {
      this._selectHasMessageStatement.reset();
    }

    return false;
  },

  get _selectInternalIDForExternalIDStatement() {
    let statement = this.createStatement(
      "SELECT id FROM messages WHERE universalID = :externalID"
    );
    this.__defineGetter__("_selectInternalIDForExternalIDStatement", function() { return statement });
    return this._selectInternalIDForExternalIDStatement;
  },

  selectInternalIDForExternalID: function(aExternalID) {
    let internalID;

    try {
      this._selectInternalIDForExternalIDStatement.params.externalID = aExternalID;
      if (this._selectInternalIDForExternalIDStatement.step())
        internalID = this._selectInternalIDForExternalIDStatement.row["id"];
    }
    finally {
      this._selectInternalIDForExternalIDStatement.reset();
    }

    return internalID;
  },

  get _insertMessageStatement() {
    let statement = this.createStatement(
      "INSERT INTO messages(sourceID, universalID, subject, author, timestamp, link) \
       VALUES (:sourceID, :universalID, :subject, :author, :timestamp, :link)"
    );
    this.__defineGetter__("_insertMessageStatement", function() { return statement });
    return this._insertMessageStatement;
  },

  /**
   * Insert a record into the messages table.
   * 
   * @param aSourceID    {integer} the record ID of the message source
   * @param aUniversalID {string}  the universal ID of the message
   * @param aSubject     {string}  the title of the message
   * @param aAuthor      {string}  the author of the message
   * @param aTimestamp   {Date}    the date/time at which the message was sent
   * @param aLink        {nsIURI}  a link to the content of the message,
   *                               if the content is hosted on a server
   *
   * @returns {integer} the ID of the newly-created record
   */
  insertMessage: function(aSourceID, aUniversalID, aSubject, aAuthor, aTimestamp, aLink) {
    this._insertMessageStatement.params.sourceID = aSourceID;
    this._insertMessageStatement.params.universalID = aUniversalID;
    this._insertMessageStatement.params.subject = aSubject;
    this._insertMessageStatement.params.author = aAuthor;
    this._insertMessageStatement.params.timestamp = aTimestamp;
    this._insertMessageStatement.params.link = aLink;
    this._insertMessageStatement.execute();
    return this.dbConnection.lastInsertRowID;
  },

  get _insertPartStatement() {
    let statement = this.createStatement(
      "INSERT INTO parts(messageID, content, contentType) \
       VALUES (:messageID, :content, :contentType)"
    );
    this.__defineGetter__("_insertPartStatement", function() { return statement });
    return this._insertPartStatement;
  },

  /**
   * Insert a record into the parts table.
   * 
   * @param aMessageID    {integer} the record ID of the message
   * @param aContentType  {string}  the Internet media type of the content
   * @param aContent      {string}  the content
   *
   * @returns {integer} the ID of the newly-created record
   */
  insertPart: function(aMessageID, aContent, aContentType) {
    this._insertPartStatement.params.messageID = aMessageID;
    this._insertPartStatement.params.content = aContent;
    this._insertPartStatement.params.contentType = aContentType;
    this._insertPartStatement.execute();
    return this.dbConnection.lastInsertRowID;
  },

  get _selectAttributeIDStatement() {
    let statement = this.createStatement(
      "SELECT id FROM attributes WHERE name = :name"
    );
    this.__defineGetter__("_selectAttributeIDStatement", function() { return statement });
    return this._selectAttributeIDStatement;
  },

  selectAttributeID: function(aName) {
    let id;

    try {
      this._selectAttributeIDStatement.params.name = aName;
      if (this._selectAttributeIDStatement.step())
        id = this._selectAttributeIDStatement.row["id"];
    }
    finally {
      this._selectAttributeIDStatement.reset();
    }

    return id;
  },

  get _insertAttributeStatement() {
    let statement = this.createStatement(
      "INSERT INTO attributes (name) VALUES (:name)"
    );
    this.__defineGetter__("_insertAttributeStatement", function() { return statement });
    return this._insertAttributeStatement;
  },

  /**
   * Insert a record into the attributes table.
   * 
   * @param aName         {string} the name of the attribute
   *
   * @returns {integer} the record ID of the newly-created record
   */
  insertAttribute: function(aName) {
    this._insertAttributeStatement.params.name = aName;
    this._insertAttributeStatement.execute();
    return this.dbConnection.lastInsertRowID;
  },

  get _insertMetadatumStatement() {
    let statement = this.createStatement(
      "INSERT INTO metadata (messageID, attributeID, value) \
       VALUES (:messageID, :attributeID, :value)"
    );
    this.__defineGetter__("_insertMetadatumStatement", function() { return statement });
    return this._insertMetadatumStatement;
  },

  /**
   * Insert a record into the metadata table.
   * 
   * @param aMessageID    {integer} the record ID of the message
   * @param aAttributeID  {integer} the record ID of the attribute
   * @param aValue        {string}  the value of the metadatum
   *
   * @returns {integer} the record ID of the newly-created record
   */
  insertMetadatum: function(aMessageID, aAttributeID, aValue) {
    this._insertMetadatumStatement.params.messageID = aMessageID;
    this._insertMetadatumStatement.params.attributeID = aAttributeID;

try {
    this._insertMetadatumStatement.params.value = aValue;
}
catch(ex) {
  dump(ex + " with attribute ID: " + aAttributeID + " and value: " + aValue + "\n");
  throw ex;
}

    this._insertMetadatumStatement.execute();
    return this.dbConnection.lastInsertRowID;
  }
};

SnowlDatastore._dbInit();
