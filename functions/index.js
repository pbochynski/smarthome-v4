const functions = require("firebase-functions");
const admin = require("firebase-admin");
// Imports the Google Cloud client library
const { BigQuery } = require("@google-cloud/bigquery");
const iot = require('@google-cloud/iot');
const client = new iot.v1.DeviceManagerClient();

// Creates a client
const bigquery = new BigQuery();
const cors = require("cors")({ origin: true });

admin.initializeApp(functions.config().firebase);

const db = admin.database();

/**
 * Receive data from pubsub, then
 * Write telemetry raw data to bigquery
 * Maintain last data on firebase realtime database
 */
exports.receiveTelemetry = functions.pubsub
  .topic("iot-topic")
  .onPublish((message, context) => {
    const attributes = message.attributes;
    const payload = message.json;
    const deviceId = attributes["deviceId"];
    const firebaseObject = {
      timestamp: context.timestamp,
      sensors: payload
    };
    let data = [];
    for (id in payload) {
      data.push({
        id: id,
        ttl: payload[id].ttl,
        t: payload[id].t,
        relay: payload[id].relay,
        time: context.timestamp
      });
    }

    return Promise.all([
      insertIntoBigquery(data),
      updateCurrentDataFirebase(deviceId, firebaseObject)
    ]);
  });

/**
 * Maintain last status in firebase
 */
function updateCurrentDataFirebase(deviceId, payload) {
  return db.ref(`/devices/${deviceId}`).set(payload);
}

/**
 * Store all the raw data in bigquery
 */
function insertIntoBigquery(data) {
  // TODO: Make sure you set the `bigquery.datasetname` Google Cloud environment variable.
  const dataset = bigquery.dataset(functions.config().bigquery.datasetname);
  // TODO: Make sure you set the `bigquery.tablename` Google Cloud environment variable.
  const table = dataset.table(functions.config().bigquery.tablename);

  return table.insert(data);
}

/**
 * Query bigquery with the last 7 days of data
 * HTTPS endpoint to be used by the webapp
 */
exports.getReportData = functions.https.onRequest(query);

async function query(req, res) {
  const table = "smarthome-181619.telemetry.sensors"; //`${projectId}.${datasetName}.${tableName}`;
  const query = `
    SELECT 
      TIMESTAMP_TRUNC(data.time, HOUR, 'America/Cuiaba') data_hora,
      avg(data.t) as avg_temp,
      min(data.t) as min_temp,
      max(data.t) as max_temp,
      count(*) as data_points      
    FROM \`${table}\` data
    WHERE data.time between timestamp_sub(current_timestamp, INTERVAL 7 DAY) and current_timestamp()
    group by data_hora
    order by data_hora
  `;

  // For all options, see https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query
  const options = {
    query: query
  };

  // Run the query as a job
  const [job] = await bigquery.createQueryJob(options);
  console.log(`Job ${job.id} started.`);

  // Wait for the query to finish
  const [rows] = await job.getQueryResults();

  // Print the results
  console.log("Rows:");
  rows.forEach(row => console.log(row));
  cors(req, res, () => {
    res.json({ data: rows });
  });
  return true;
}


/**
 * Responds to any HTTP request.
 *
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */

async function getConfig(deviceId) {
  const projectId = await client.getProjectId();
  const name = client.devicePath(projectId, 'europe-west1', 'iot-registry',deviceId);
  return client.listDeviceConfigVersions({name: name, numVersions:1})
  .then(responses => {
    const response = responses[0];
    //console.log(response);
    const config = response.deviceConfigs[0];
    //console.log(config.binaryData.toString());
    return config.binaryData.toString();
  })
  .catch(err => {
    console.error(err);
  });
}

async function setConfig(deviceId, config) {
  const projectId = await client.getProjectId();
  const formattedName = client.devicePath(projectId, 'europe-west1', 'iot-registry',deviceId);

  const binaryData = Buffer.from(JSON.stringify(config));
  const request = {
    name: formattedName,
    binaryData: binaryData,
  };
  return client.modifyCloudToDeviceConfig(request)
    .then(responses => {
      return responses[0];
    })
    .catch(err => {
      console.error(err);
    });
}

exports.getIoTConfig = functions.https.onRequest(async (req, res) => {
  let message = await getConfig(req.query.id)
  res.status(200).send(message);
});

exports.setIoTConfig = functions.database.ref('config/{deviceId}').onWrite(async (change, event) => {
  console.log("DeviceId: %s",event.params.deviceId);
  console.log("Before: %s",JSON.stringify(change.before.val()));
  console.log("After: %s",JSON.stringify(change.after.val()));
  return setConfig(event.params.deviceId,change.after.val() );
});
