/**
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
"use strict";

// Shortcuts to DOM Elements.
var thermostatInput = document.getElementById("thermostat");
var deviceId = document.getElementById("deviceId");
var sensorRows = document.getElementById("sensorRows");
var slider = document.getElementById("slider");
var signInButton = document.getElementById("sign-in-button");
var signOutButton = document.getElementById("sign-out-button");
var splashPage = document.getElementById("page-splash");
var lastUpdate = document.getElementById("last-update");
var aliases = {};
var listeningFirebaseRefs = [];
var lastTimestamp = null;

/**
 * Saves a new post to the Firebase DB.
 */
// [START write_fan_out]
function writeConfig(deviceId, config) {
  return firebase
    .database()
    .ref("config/" + deviceId)
    .set(config);
}
function aliasFor(id) {
  return aliases[id] || id;
}

function minTemp(sensors) {
  var min = 100;
  for (var id in sensors) {
    if (sensors[id].t < min) {
      min = sensors[id].t;
    }
  }
  return min < 100 ? min.toFixed(1) : "--";
}

function sensorTable(sensors) {
  var txt = "";
  for (var id in sensors) {
    txt += "<tr>" + '<td class="mdl-data-table__cell--non-numeric">' + aliasFor(id) + "</td>" 
    + "<td>" + sensors[id].t + "</td>" 
    + "<td>" + (sensors[id].target || "")  + "</td>"     
    + "<td>" + (sensors[id].relay ? "on" :"off")  + "</td>"     
    + "</tr>";
  }
  return txt;
}
/**
 * Starts listening for new posts and populates posts lists.
 */

function getMyDevices() {
  var devicesRef = firebase.database().ref("users/");

}

function startDatabaseQueries() {
  // [START my_top_posts_query]
  var devicesRef = firebase.database().ref("devices");
  var aliasesRef = firebase.database().ref("aliases");
  var configRef = firebase.database().ref("config");
  var presetRef = firebase.database().ref("presets");

  var fetchDevices = function(devicesRef) {
    devicesRef.on("value", snapshot => {
      var data = snapshot.val();

      for (var id in data) {
        if (id == deviceId.value) {
          sensorRows.innerHTML = sensorTable(data[id].sensors);
          lastTimestamp = new Date(data[id].timestamp).getTime();
          document.getElementById("current").innerText = minTemp(data[id].sensors);
          document.getElementById("fire").style.display = data[id].sensors[id].relay ? "" : "none";
          document.getElementById("sync").style.display = data[id].sensors[id].target == slider.value ? "none" : "";
        }
      }
    });
  };
  var fetchAliases = function(aliasesRef) {
    aliasesRef.on("value", snapshot => {
      aliases = snapshot.val();
      getChartData();
    });
  };
  var fetchConfig = function(configRef) {
    configRef.on("value", snapshot => {
      let config = snapshot.val();
      let id = deviceId.value;
      if (deviceId.value && config[id] && config[id].t) {
        slider.MaterialSlider.change(config[id].t);
        showMessage();
      }
    });
  };
  var fetchPresets = function(presetRef) {
    presetRef.on("value", snapshot => {
      let data = snapshot.val();
      let presets = document.getElementById("presets");
      let html = "<p>";
      presets.innerHTML = "";
      for (let id in data) {
        let style = data[id].style || "mdl-button--colored";
        let t = data[id].t;
        let label = data[id].label || id;
        html +=
          '&nbsp;<button class="mdl-button mdl-js-button mdl-button--raised ' +
          style +
          '" onclick="setPreset(' +
          t +
          ')">' +
          label +
          "</button>&nbsp;";
      }
      html += "</p>";
      presets.innerHTML = html;
      if (componentHandler) {
        componentHandler.upgradeElements(presets);
      }
    });
  };
  fetchAliases(aliasesRef);
  fetchConfig(configRef);
  fetchDevices(devicesRef);
  fetchPresets(presetRef);

  // Keep track of all Firebase refs we are listening to.
  listeningFirebaseRefs.push(devicesRef);
}

setInterval(()=>{
  if (lastTimestamp) {
    lastUpdate.innerText = "Last update: " + Math.round((new Date().getTime()-lastTimestamp)/1000) +" seconds ago";
  }

}, 1000);
/**
 * Writes the user's data to the database.
 */
// [START basic_write]
function writeUserData(userId, name, email, imageUrl) {
  firebase
    .database()
    .ref("users/" + userId)
    .set({
      username: name,
      email: email,
      profile_picture: imageUrl
    });
}
// [END basic_write]

/**
 * Cleanups the UI and removes all Firebase listeners.
 */
function cleanupUi() {
  // Stop all currently listening Firebase listeners.
  listeningFirebaseRefs.forEach(function(ref) {
    ref.off();
  });
  listeningFirebaseRefs = [];
}

/**
 * The ID of the currently signed-in User. We keep track of this to detect Auth state change events that are just
 * programmatic token refresh but not a User status change.
 */
var currentUID;

/**
 * Triggers every time there is a change in the Firebase auth state (i.e. user signed-in or user signed out).
 */
function onAuthStateChanged(user) {
  // We ignore token refresh events.
  if (user && currentUID === user.uid) {
    return;
  }

  cleanupUi();
  if (user) {
    currentUID = user.uid;
    splashPage.style.display = "none";
    writeUserData(user.uid, user.displayName, user.email, user.photoURL);
    startDatabaseQueries();
  } else {
    // Set currentUID to null.
    currentUID = null;
    // Display the splash page where you can sign-in.
    splashPage.style.display = "";
  }
}


function getChartData() {
  fetch("https://us-central1-smarthome-181619.cloudfunctions.net/getReportData").then(async response => {
    let report = await response.json();
    let sensors = sensorList(report.data);
    document.getElementById("charts").innerHTML = "";

    for (let i in sensors) {
      let chartNode = document.createElement("canvas");
      document.getElementById("charts").appendChild(chartNode);
      drawChart(chartNode, report.data, sensors[i]);
    }
  });
}

function sensorList(report) {
  let list = {};
  report.forEach(r => {
    list[r.id] = true;
  });
  return Object.keys(list);
}

function drawChart(chartNode, report, sensor) {
  var ctx = chartNode.getContext("2d");

  let data = {
    labels: [],
    datasets: [
      { label: "min", fill: false, showLine: true, borderColor: "#00bcd6", data: [] },
      { label: "avg", fill: false, borderColor: "#48b04b", data: [] },
      { label: "max", fill: false, showLine: true, borderColor: "#ff5605", data: [] }
    ]
  };
  let options = {
    title: {
      display: true,
      text: aliasFor(sensor)
    },
    scales: {
      xAxes: [
        {
          ticks: {
            display: true //this will remove only the label
          }
        }
      ]
    },
    legend: { display: false },
    responsive: true
  };
  report.forEach(r => {
    if (r.id == sensor) {
      data.labels.push(new Date(r.t.value).toLocaleTimeString());
      data.datasets[0].data.push(r.min_temp);
      data.datasets[1].data.push(r.avg_temp);
      data.datasets[2].data.push(r.max_temp);
    }
  });
  new Chart(ctx, { type: "line", data, options });
}

// Bindings on load.
window.addEventListener(
  "load",
  function() {
    // Bind Sign in button.
    signInButton.addEventListener("click", function() {
      var provider = new firebase.auth.GoogleAuthProvider();
      firebase.auth().signInWithRedirect(provider);
    });

    // Bind Sign out button.
    signOutButton.addEventListener("click", function() {
      firebase.auth().signOut();
    });

    // Listen for auth state changes
    firebase.auth().onAuthStateChanged(onAuthStateChanged);
    slider.addEventListener("input", showMessage);
    slider.addEventListener("change", setTemp);
    
    toggleAdminView();
  },
  false
);

function switchThermostat() {
  let on = document.getElementById("switch").checked;

  document.getElementById("switch-label").innerText = on ? "on" : "off";
  let nodes = document.getElementsByClassName("on-off");
  for (let i = 0; i < nodes.length; ++i) {
    nodes[i].style.display = on ? "" : "none";
  }

  writeConfig(deviceId.value, { mode: on ? "auto" : "off", t: parseFloat(slider.value) });
}

function toggleAdminView() {
  let nodes = document.getElementsByClassName("admin-view");
  let adminOn = window.location.hash == "#admin"
  for (let i = 0; i < nodes.length; ++i) {
    nodes[i].style.display = adminOn ? "" : "none";
  }
}

function setPreset(t) {
  if (deviceId.value) {
    writeConfig(deviceId.value, { mode: "auto", t: parseFloat(t) });
  }
}

function setTemp() {
  if (deviceId.value) {
    writeConfig(deviceId.value, { mode: "auto", t: parseFloat(slider.value) });
  }
}
function showMessage() {
  document.getElementById("temperature").innerText = slider.value;
}
