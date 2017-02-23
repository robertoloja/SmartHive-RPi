// TODO: Web client needs to ask for Hive name.

var express = require('express');
var firebase = require('firebase');
var admin = require('firebase-admin');
var bodyParser = require('body-parser');
var MongoClient = require('mongodb').MongoClient
var assert = require('assert');
var opn = require('opn');
var fs = require('fs');

var serviceAccount = require("./sh.json"); // Downloaded from firebase console
var url = 'mongodb://localhost:27017/sensorData'; // MongoDB URL
var firebaseDB;
var app;


// Express server.
app = express();
app.use(express.static('public'));
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());

// Serve index page of web client for authentication.
app.get('/', function (req, res) {
  res.sendFile( __dirname + "/index.html" );
});

// Serve wifi instructions
app.get('/wifi.html', function (req, res) {
  res.sendFile( __dirname + "/wifi.html" );
});

var server = app.listen(3000, function () {
  var host = server.address().address
  var port = server.address().port
  console.log("SmartHive login server listening on port", port)
});


/**
  * hiveInfo is a Promise that will contain UID, HID and hiveName.
  * It MUST be used by invoking its then() method, which receives a 
  * callback that has one parameter, in this case an object containing hive 
  * info (uid, hid, hiveName). Anything needing these values HAS to be done 
  * from within that callback, or risk them being undefined.
  */
var hiveInfo = new Promise((resolve, reject) => {
  MongoClient.connect(url, (err, mongoDB) => {
    console.log(err);
    assert.equal(null, err);
    // get UID from MongoDB, if it exists.
    mongoDB.collection('hiveInfo').find({'uid': /./}).toArray((err, docs) => {
      assert.equal(null, err);

      // This just makes 'docs' easier to deal with.
      if (docs.length == 0)
        docs = {};
      else
        docs = docs[0];

      /**
      * Setup POST receiver, to accept Google UID once user logs in.
      * This has to be a Promise, so it can be resolved when UID is
      * actually needed.
      */
      var uidPromise = new Promise((resolve, reject) => {
        if (docs['uid'] != undefined)
          resolve(docs['uid']);

        app.post('/token', (req, res) => {
          var uid_and_name = {
            'uid': req.body.uid,
            'name': req.body.name
          };
          resolve(uid_and_name);
        });
      });


      if (docs['uid'] == undefined) { // UID not in MongoDB
        opn('http://localhost:3000'); // open browser

        uidPromise.then((uid) => { // resolved once user logs in
          docs['uid'] = uid['uid'];
          docs['name'] = uid['name'];

          connectToFirebase(uid['uid']);

          var hive = {
            'name': uid['name'],
            'date_created': Math.round(Date.now() / 1000), // seconds
            'location': '0.0, 0.0'
          };

          var ref = firebaseDB.ref('users/' + uid['uid']);

          docs['hid'] = ref.push(hive).key; // This key is the HID.

          mongoDB.collection('hiveInfo').insert({ // update MongoDB.
                          'uid': docs['uid'],
                          'name': docs['name'],
                          'hid': docs['hid']
          });
          delete docs['_id'];
          resolve(docs);
        });
      } else {
        delete docs['_id'];
        resolve(docs);
      }
    });
    mongoDB.close();
  });
});

// This actually cashes out the Promise.
hiveInfo.then((info) => {
    console.log('Using UID =', info['uid'], ', HID =', info['hid']);
});

getLocalSensorData();

/**
* Read data from the MongoDB instance and write any unwritten data to Firebase.
*/
function getLocalSensorData() {
  MongoClient.connect(url, (err, mongoDB) => {
    assert.equal(null, err);
    var data = mongoDB.collection('data');

    data.find({'uploaded': false}).toArray((err, docs) => {
      assert.equal(null, err);

      hiveInfo.then((info) => {
        var ref = firebaseDB.ref('users/' + info['uid'] +
                                 '/' + info['hid'] + '/data');

        for (var i = 0; i < docs.length; i++) {
          delete docs[i]['_id']; // strip Mongo's index from the data.
          delete docs[i]['uploaded']; // strip uploaded field.

          ref.push(docs[i]);

          data.updateOne({'date': docs[i]['date']},
                        {$set: {'uploaded': true}},
                        (err, r) => {
            assert.equal(null, err);
            assert.equal(1, r.matchedCount);
            assert.equal(1, r.modifiedCount);
          });
        }
      });
    });
  });
}


/**
 * Establish user-limited connection to Firebase. Can only
 * be done once UID has been acquired.
 * @param {String} userID The Google account's Firebase UID.
 */
function connectToFirebase(userID) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://smarthive-229a5.firebaseio.com",
    databaseAuthVariableOverride: {
      uid: userID
    }
  });
  firebaseDB = admin.database();
}


/**
* Check internet connection.
* @return {Boolean} true if connected, false otherwise.
*/
function isOnline() {
  require('dns').resolve('www.google.com', (err) => {
    if (err) {
      console.log("Failed to connect.");
      return true;
    } else {
      console.log("Connection acquired.");
      return false;
    }
  });
}
