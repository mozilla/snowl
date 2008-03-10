var gBrowserWindow = window.QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIWebNavigation).
                     QueryInterface(Ci.nsIDocShellTreeItem).
                     rootTreeItem.
                     QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIDOMWindow);

SourcesView = {
  get _tree() {
    let tree = document.getElementById("sourcesView");
    delete this._tree;
    this._tree = tree;
    return this._tree;
  },

  get _children() {
    let children = this._tree.getElementsByTagName("treechildren")[0];
    delete this._children;
    this._children = children;
    return this._children;
  },

  init: function() {
    let statementString = "SELECT title, id FROM sources ORDER BY title";

    let statement = SnowlDatastore.createStatement(statementString);

    // Empty the view.
    while (this._children.hasChildNodes())
      this._children.removeChild(this._children.lastChild);

    // Rebuild the view.
    this._addItem(null, "All");
    while (statement.step())
      this._addItem(statement.row.id, statement.row.title);

    // Select the subscription that the messages view is currently displaying.
    for (let i = 0; i < this._children.childNodes.length; i++) {
      let item = this._children.childNodes[i];
      if (item.sourceID == gBrowserWindow.SnowlView.sourceID) {
        this._tree.view.selection.select(i)
        break;
      }
    }
  },

  _addItem: function(aSourceID, aTitle) {
    let item = document.createElement("treeitem");
    item.sourceID = aSourceID;
    let row = document.createElement("treerow");

    let titleCell = document.createElement("treecell");
    titleCell.setAttribute("label", aTitle);

    row.appendChild(titleCell);
    item.appendChild(row);
    this._children.appendChild(item);
  },

  onSelect: function(aEvent) {
    if (this._tree.currentIndex == -1)
      return;
    let sourceID = this._children.childNodes[this._tree.currentIndex].sourceID;
    gBrowserWindow.SnowlView.setSource(sourceID);
  }

};

window.addEventListener("load", function() { SourcesView.init() }, false);
