// modules that come with Firefox

// modules that are generic
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");

// Snowl-specific modules
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/datastore.js");

let server;

function run_test() {
  server = new nsHttpServer();
  let basePath = do_get_file("test/unit/");
  server.registerDirectory("/", basePath);
  server.start(8080);

  do_test_pending();

  Observers.add("snowl:subscribe:get:end", finish_test);
  let feed = new SnowlFeed(null, null, new URI("http://localhost:8080/feed.xml"), undefined, null);
  feed.subscribe();
}

function finish_test() {
  server.stop();
  SnowlDatastore.finalizeStatements();
  let databaseFile = SnowlDatastore.dbConnection.databaseFile;
  SnowlDatastore.dbConnection.close();
  databaseFile.remove(false);
  do_test_finished();
}
