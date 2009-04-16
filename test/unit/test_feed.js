// modules that come with Firefox

// modules that are generic
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");

// Snowl-specific modules
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/service.js");

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
  try {
    do_check_eq(SnowlService.accounts.length, 1);
    let account = SnowlService.accounts[0];
    do_check_eq(account.id.constructor.name, "Number");
    do_check_eq(account.constructor.name, "SnowlFeed");
    do_check_eq(account.name, "Example Feed");
    do_check_eq(account.machineURI.spec, "http://localhost:8080/feed.xml");
    do_check_eq(account.humanURI.spec, "http://example.org/");
    do_check_eq(account.username, null);
    do_check_eq(account.lastRefreshed, null);
    do_check_eq(account.importance, null);
    do_check_eq(account.placeID.constructor.name, "Number");

    let collection = new SnowlCollection();
    // Must invalidate because of bug 488615; FIXME: remove this once that bug
    // is fixed.
    collection.invalidate();
    let messages = collection.messages;
    do_check_eq(messages.length, 1);
  }
  finally {
    server.stop();
    deleteDatabase();
    do_test_finished();
  }
}
