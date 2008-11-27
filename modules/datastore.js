/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Snowl.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Myk Melez <myk@mozilla.org>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

let EXPORTED_SYMBOLS = ["SnowlDatastore"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that come with Firefox
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");

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

  _dbVersion: 8,

  _dbSchema: {
    // Note: datetime values like messages:timestamp are stored as Julian dates.

    // Note: the externalID is a unique identifier established by the source
    // of the message which remains constant across message transfer points
    // and destinations.  For feeds this is the entry ID; for email messages
    // it's the message ID.

    // FIXME: make the datastore support multiple authors.
    // FIXME: support labeling the subject as HTML or another content type.
    // FIXME: index by externalID to make lookups (f.e. when checking if we
    // already have a message) and updates (f.e. when setting current) faster.

    tables: {
      sources: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          "type TEXT NOT NULL",
          "name TEXT NOT NULL",
          // XXX Call these URL instead of URI, since they are unambiguously
          // locations, not names (and thus never URNs)?
          "machineURI TEXT NOT NULL",
          "humanURI TEXT",
          "username TEXT",
          "lastRefreshed REAL",
          "importance INTEGER"
        ]
      },

      messages: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          "sourceID INTEGER NOT NULL REFERENCES sources(id)",
          "externalID TEXT",
          "subject TEXT",
          "authorID INTEGER REFERENCES people(id)",

          // timestamp represents the date/time assigned to the message by its
          // source.  It can have multiple meanings, including when the message
          // was 'sent' by its author, when it was published, and when it was
          // last updated.
          "timestamp REAL",

          // received represents the date/time at which the message was first
          // received by this application.
          "received REAL",

          "link TEXT",
          "current BOOLEAN DEFAULT 1",
          "read BOOLEAN DEFAULT 0"
        ]
      },

      parts: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          "messageID INTEGER NOT NULL REFERENCES messages(id)",
          "content NOT NULL",
          // The DEFAULT constraint helps when upgrading from schemas
          // that didn't require mediaType to be NOT NULL, so it might
          // have contained NULL values.
          "mediaType TEXT NOT NULL DEFAULT 'application/octet-stream'",
          "partType INTEGER NOT NULL",
          "baseURI TEXT",
          "languageTag TEXT"
        ]
      },

      partsText: {
        type: TABLE_TYPE_FULLTEXT,
        columns: [
          // partsText has an implicit docid column whose value we set to the ID
          // of the corresponding record in the parts table so we can join them
          // to get the part (and thence message) for a fulltext search result.
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

      // FIXME: call this messageMetadata, since we have one for people, too
      // (and might get one for sources in the future).
      // XXX Should we call this "properties"?
      metadata: {
        type: TABLE_TYPE_FULLTEXT,
        columns: [
          "messageID INTEGER NOT NULL REFERENCES messages(id)",
          "attributeID INTEGER NOT NULL REFERENCES attributes(id)",
          "contentType TEXT NOT NULL",
          "value BLOB"
        ]
      },

      people: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          // XXX Should we store this info as part of the identity, so that
          // a person with multiple identities could retain information from
          // all of them and select from it at display time?
          "name TEXT NOT NULL",
          "homeURL TEXT",
          "iconURL TEXT"
        ]
      },

      personMetadata: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "personID INTEGER NOT NULL REFERENCES people(id)",
          "attributeID INTEGER NOT NULL REFERENCES attributes(id)",
          "value BLOB"
        ]
      },

      identities: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          "sourceID INTEGER NOT NULL REFERENCES sources(id)",
          "externalID TEXT NOT NULL",
          "personID INTEGER NOT NULL REFERENCES people(id)",
          "UNIQUE(externalID, sourceID)"
        ]
      },

      collections: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          "name TEXT NOT NULL",
          "iconURL TEXT",
          "orderKey INTEGER NOT NULL DEFAULT 0",
          "grouped BOOLEAN DEFAULT 0",
          "groupIDColumn TEXT",
          "groupNameColumn TEXT",
          "groupHomeURLColumn TEXT",
          "groupIconURLColumn TEXT"
        ]
      }

    }

  },

  _defaultCollections: [
    { name:               "All",
      iconURL:            "chrome://snowl/content/icons/rainbow.png",
      orderKey:           1,
      grouped:            false },

    { name: "Sources",
      iconURL:            "chrome://browser/skin/feeds/feedIcon16.png",
      orderKey:           2,
      grouped:            true,
      groupIDColumn:      "sources.id",
      groupNameColumn:    "sources.name",
      groupHomeURLColumn: "sources.humanURI" },

    { name:               "Authors",
      iconURL:            "chrome://snowl/content/icons/user.png",
      orderKey:           3,
      grouped:            true,
      groupIDColumn:      "authors.id",
      groupNameColumn:    "authors.name",
      groupIconURLColumn: "authors.iconURL" }
  ],

  dbConnection: null,

  createStatement: function(aSQLString, aDBConnection) {
    let dbConnection = aDBConnection ? aDBConnection : this.dbConnection;

    try {
      var statement = dbConnection.createStatement(aSQLString);
    }
    catch(ex) {
      throw("error creating statement " + aSQLString + " - " +
            dbConnection.lastError + ": " +
            dbConnection.lastErrorString + " - " + ex);
    }

    var wrappedStatement = new InstrumentedStorageStatement(aSQLString);
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
      this._dbInsertDefaultData(dbConnection);
      dbConnection.commitTransaction();
    }
    catch(ex) {
      dbConnection.rollbackTransaction();
      throw ex;
    }

    return dbConnection;
  },

  _dbCreateTables: function(aDBConnection) {
    for (let tableName in this._dbSchema.tables) {
      let table = this._dbSchema.tables[tableName];
      this._dbCreateTable(aDBConnection, tableName, table);
    }

    aDBConnection.schemaVersion = this._dbVersion;
  },

  _dbCreateTable: function(aDBConnection, tableName, table) {
    switch (table.type) {
      case TABLE_TYPE_FULLTEXT:
        aDBConnection.executeSimpleSQL(
          "CREATE VIRTUAL TABLE " + tableName +
          " USING fts3(" + table.columns.join(", ") + ")"
        );
        break;

      case TABLE_TYPE_NORMAL:
      default:
        aDBConnection.createTable(tableName, table.columns.join(", "));
        break;
    }
  },

  _dbInsertDefaultData: function(aDBConnection) {
    let params = ["name", "iconURL", "orderKey", "grouped", "groupIDColumn",
                  "groupNameColumn", "groupHomeURLColumn",
                  "groupIconURLColumn"];

    let statement = this.createStatement(
      "INSERT INTO collections (" + params.join(", ") + ") " +
      "VALUES (" + params.map(function(v) ":" + v).join(", ") + ")",
      aDBConnection);

    for each (let collection in this._defaultCollections) {
      for each (let param in params)
        statement.params[param] = (param in collection) ? collection[param] : null;
      statement.execute();
    }
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
   * Migrate the database schema from version 0 to the current version.
   * 
   * We never create a database with version 0, so the database can only
   * have that version if the database file was created without the schema
   * being constructed.  Thus migrating the database is as simple as
   * constructing the schema as if from scratch.
   *
   * FIXME: special case the calling of this function so we don't have to
   * update its name every time we increase the current schema version.
   */
  _dbMigrate0To8: function(aDBConnection) {
    this._dbCreateTables(aDBConnection);
  },

  /**
   * Upgrade database schema from version 4 (0.1, 0.1.1) to current version.
   *
   * FIXME: do multi-version upgrades automatically if it's possible to get to
   * the latest version via a series of steps instead of writing one-off functions
   * like this one to do the database migration.
   */
  _dbMigrate4To8: function(aDBConnection) {
    this._dbMigrate4To5(aDBConnection);
    this._dbMigrate5To6(aDBConnection);
    this._dbMigrate6To7(aDBConnection);
    this._dbMigrate7To8(aDBConnection);
  },

  /**
   * Upgrade database schema from version 5 (0.2pre1, 0.2pre2) to current version.
   */
  _dbMigrate5To8: function(aDBConnection) {
    this._dbMigrate5To6(aDBConnection);
    this._dbMigrate6To7(aDBConnection);
    this._dbMigrate7To8(aDBConnection);
  },

  _dbMigrate4To5: function(aDBConnection) {
    aDBConnection.executeSimpleSQL(
      "UPDATE sources SET lastRefreshed = lastRefreshed / 1000 / 86400 + 2440587.5"
    );
    aDBConnection.executeSimpleSQL(
      "UPDATE messages SET timestamp = timestamp / 1000 / 86400 + 2440587.5"
    );
    aDBConnection.executeSimpleSQL(
      "ALTER TABLE messages ADD COLUMN received REAL"
    );
  },

  _dbMigrate5To6: function(aDBConnection) {
    // Rename the old parts table.
    aDBConnection.executeSimpleSQL("ALTER TABLE parts RENAME TO partsOld");

    // Create the new parts and partsText tables.
    this._dbCreateTable(aDBConnection, "parts", this._dbSchema.tables.parts);
    this._dbCreateTable(aDBConnection, "partsText", this._dbSchema.tables.partsText);

    // Copy the data from the old to the new parts table.  It may look like
    // the tables are equivalent, but the old table was fulltext and didn't have
    // an "id" column (which we don't reference here because it gets populated
    // automagically as an AUTOINCREMENT PRIMARY KEY column).
    aDBConnection.executeSimpleSQL(
      "INSERT INTO parts(messageID, content, mediaType, partType, baseURI, languageTag) " +
      "SELECT            messageID, content, mediaType, partType, baseURI, languageCode " +
      "FROM partsOld"
    );

    // Insert data into the new partsText table.
    let selectStatement = this.createStatement("SELECT id, content, mediaType FROM parts", aDBConnection);
    let insertStatement = this.createStatement("INSERT INTO partsText (docid, content) VALUES (:docid, :content)", aDBConnection);
    try {
      while (selectStatement.step()) {
        let plainText = selectStatement.row.content;

        switch (selectStatement.row.mediaType) {
          case "text/html":
          case "application/xhtml+xml":
            // Use nsIFeedTextConstruct to convert the markup to plaintext.
            let (construct = Cc["@mozilla.org/feed-textconstruct;1"].
                             createInstance(Ci.nsIFeedTextConstruct)) {
              construct.text = selectStatement.row.content;
              construct.type = TEXT_CONSTRUCT_TYPES[selectStatement.row.mediaType];
              plainText = construct.plainText();
            }
            // Now that we've converted the markup to plain text, fall through
            // to the text/plain case that inserts the data into the database.

          case "text/plain":
            // Give the fulltext record the same doc ID as the row ID of the parts
            // record so we can join them together to get the part (and thence the
            // message) when doing a fulltext search.
            insertStatement.params.docid = selectStatement.row.id;
            insertStatement.params.content = plainText;
            insertStatement.execute();
            break;

          default:
            // It isn't a type we understand, so don't do anything with it.
            // XXX If it's text/*, shouldn't we fulltext index it anyway?
        }
      }
    }
    finally {
      selectStatement.reset();
    }

    // Drop the old parts table.
    aDBConnection.executeSimpleSQL("DROP TABLE partsOld");
  },

  /**
   * Migrate the database schema from version 6 to version 7.
   *
   * This doesn't actually change the physical database schema, it just removes
   * subjects from Twitter messages, since it no longer makes sense to store
   * tweets as both the subjects and the content of messages now that the views
   * support messages that don't necessarily have subjects.
   */
  _dbMigrate6To7: function(aDBConnection) {
    aDBConnection.executeSimpleSQL(
      "UPDATE messages SET subject = NULL WHERE sourceID IN " +
      "(SELECT id FROM sources WHERE type = 'SnowlTwitter')"
    );
  },

  /**
   * Migrate the database schema from version 7 to version 8.
   */
  _dbMigrate7To8: function(aDBConnection) {
    aDBConnection.executeSimpleSQL("ALTER TABLE sources ADD COLUMN username TEXT");
  },

  get _selectHasSourceStatement() {
    let statement = this.createStatement(
      "SELECT name FROM sources WHERE machineURI = :machineURI"
    );
    this.__defineGetter__("_selectHasSourceStatement", function() { return statement });
    return this._selectHasSourceStatement;
  },

  selectHasSource: function(aMachineURI) {
    let name;

    try {
      this._selectHasSourceStatement.params.machineURI = aMachineURI;
      if (this._selectHasSourceStatement.step())
        name = this._selectHasSourceStatement.row["name"];
    }
    finally {
      this._selectHasSourceStatement.reset();
    }

    return name;
  },

  get _selectHasMessageStatement() {
    let statement = this.createStatement(
      "SELECT 1 FROM messages WHERE externalID = :externalID"
    );
    this.__defineGetter__("_selectHasMessageStatement", function() { return statement });
    return this._selectHasMessageStatement;
  },

  selectHasMessage: function(aExternalID) {
    try {
      this._selectHasMessageStatement.params.externalID = aExternalID;
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
      "SELECT id FROM messages WHERE externalID = :externalID"
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
      "INSERT INTO messages(sourceID, externalID, subject, authorID, timestamp, received, link) \
       VALUES (:sourceID, :externalID, :subject, :authorID, :timestamp, :received, :link)"
    );
    this.__defineGetter__("_insertMessageStatement", function() { return statement });
    return this._insertMessageStatement;
  },

  /**
   * Insert a record into the messages table.
   * 
   * @param aSourceID    {integer} the record ID of the message source
   * @param aExternalID  {string}  the external ID of the message
   * @param aSubject     {string}  the title of the message
   * @param aAuthorID    {string}  the author of the message
   * @param aTimestamp   {real}    the Julian date when the message was sent
   * @param aReceived    {real}    the Julian date when the message was received
   * @param aLink        {string}  a link to the content of the message,
   *                               if the content is hosted on a server
   *
   * @returns {integer} the ID of the newly-created record
   */
  insertMessage: function(aSourceID, aExternalID, aSubject, aAuthorID, aTimestamp, aReceived, aLink) {
    this._insertMessageStatement.params.sourceID = aSourceID;
    this._insertMessageStatement.params.externalID = aExternalID;
    this._insertMessageStatement.params.subject = aSubject;
    this._insertMessageStatement.params.authorID = aAuthorID;
    this._insertMessageStatement.params.timestamp = aTimestamp;
    this._insertMessageStatement.params.received = aReceived;
    this._insertMessageStatement.params.link = aLink;
    this._insertMessageStatement.execute();

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

  // FIXME: insert the namespace, too, if available.
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

// FIXME: don't wrap statements in this wrapper for stable releases.

/**
 * An implementation of mozIStorageStatementWrapper that logs execution times
 * for debugging.  Even though this implements an XPCOM interface, it isn't
 * an XPCOM component, it's a regular JS object, so instead of instantiating it
 * via createInstance, do |new InstrumentedStorageStatement()|.
 *
 * @param sqlString {string} the SQL string used to construct the statement
 *                           (optional, but essential for useful debugging)
 */
function InstrumentedStorageStatement(sqlString) {
  this._sqlString = sqlString;
  //this._log = Log4Moz.repository.getLogger("Snowl.Statement");
}

InstrumentedStorageStatement.prototype = {
  /**
   * The SQL string used to construct the statement.  We log this along with
   * the execution time when the statement is executed.
   */
  _sqlString: null,

  /**
   * The wrapped mozIStorageStatementWrapper (which itself wraps
   * a mozIStorageStatement).
   */
  _statement: null,

  get _log() {
    let log = Log4Moz.repository.getLogger("Snowl.Statement");
    this.__defineGetter__("_log", function() log);
    return this._log;
  },

  // nsISupports
  QueryInterface: XPCOMUtils.generateQI([Ci.mozIStorageStatementWrapper]),

  // mozIStorageStatementWrapper

  initialize: function(statement) {
    this._statement = Cc["@mozilla.org/storage/statement-wrapper;1"].
                      createInstance(Ci.mozIStorageStatementWrapper);
    this._statement.initialize(statement);
  },

  get statement() { return this._statement },
  reset: function() { return this._statement.reset() },

  step: function() {
    // We don't want to log every step, just the first one, which triggers
    // the execution of the query and is potentially slow.
    let log = (this._statement.statement.state != Ci.mozIStorageStatement.MOZ_STORAGE_STATEMENT_EXECUTING);

    let before = new Date();
    let rv = this._statement.step();
    let after = new Date();
    let time = after - before;
    if (log)
      this._log.trace(time + "ms to step initially " + this._sqlString);
    return rv;
  },

  execute: function() {
    let before = new Date();
    let rv = this._statement.execute();
    let after = new Date();
    let time = after - before;
    this._log.trace(time + "ms to execute " + this._sqlString);
    return rv;
  },
  get row() { return this._statement.row },
  get params() { return this._statement.params }
};


SnowlDatastore._dbInit();
