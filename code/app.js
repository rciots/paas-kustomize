const express = require('express');
const fs = require('fs');
const app = express();
const mongoose = require('mongoose');
const { exec } = require('child_process');
const zlib = require('zlib');
const Device = require('./models/schemas').Device;
const Template = require('./models/schemas').Template; 
const PORT = process.env.PORT || 8080;

const mongodb = process.env.MONGODB_CONNECT || 'mongodb://mongodb:27017/userdb';

mongoose.connect(mongodb, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
  console.log('Database connected!');
});
app.get('/:id', (req, res) => {
    const id = req.params.id;
    if (id == "favicon.ico"){
      return;
    }
    (async () => {
      try {
        const foundDevice = await Device.findById(id).exec();
            if (!foundDevice) {
                console.error(`Device with ID ${deviceId} not found`);
                return res.json({ send: false, message: 'Device not found' });
            }
            var sendFiles = false;
            fs.mkdir("./tmp/" + foundDevice._id + "/device", { recursive: true }, (error) => {
                if (error) {
                    console.error('Error creating directory:', error);
                    return res.json({ send: false, message: 'Error creating directory: ./tmp/' + foundDevice._id + "/device"});
                } else {
                    fs.mkdir("./tmp/" + foundDevice._id + "/base", { recursive: true }, (error) => {
                        if (error) {
                          console.error('Error creating directory:', error);
                          return res.json({ send: false, message: 'Error creating directory: ./tmp/' + foundDevice._id + "/base"});
                        } else {
                            foundDevice.files.forEach((obj) => {
                              sendFiles = true;
                                const { name, content } = obj;
                                fs.writeFile("./tmp/" + foundDevice._id + "/device/" + name, content, (err) => {
                                  if (err) {
                                    console.error(`Error creating file ${name}:`, err);
                                  }
                                });
                            });
                            (async () => {
                              try {
                                const foundTemplate = await Template.findById(foundDevice.template).exec();
                                if (((!foundTemplate) || (foundTemplate.files == [])) && (foundDevice.files == [])) {
                                    console.error("Template not found");
                                    return res.json({ send: false, message: "Empty files to send"});
                                }
                                if (foundTemplate) {
                                  foundTemplate.files.forEach((obj) => {
                                      sendFiles = true;
                                      const { name, content } = obj;
                                      fs.writeFile("./tmp/" + foundDevice._id + "/base/" + name, content, (err) => {
                                        if (err) {
                                          console.error(`Error creating file ${name}:`, err);
                                        }
                                      });
                                  });
                                }
                                if (sendFiles){
                                  try {
                                    fs.mkdirSync("tmp/" + foundDevice._id + "/device/resources");
                                  } catch (error) {
                                    console.error('Error creating directory:', error);
                                  }
                                  if (!fs.existsSync("tmp/" + foundDevice._id + "/device/kustomization.yaml")) {
                                    fs.writeFileSync("tmp/" + foundDevice._id + "/device/kustomization.yaml", 'resources:\n  - ../base');
                                  }
                                  const commandResources = "oc kustomize tmp/" + foundDevice._id + "/device > tmp/" + foundDevice._id + "/device/resources/resources.yaml";
                                  exec(commandResources, (errorR, stdoutR, stderrR) => {
                                    if (error) {
                                      console.error(`Error executing command: ${errorR.message}`);
                                      return;
                                    }
                                    if (stderr) {
                                      console.error(`Command stderr: ${stderrR}`);
                                      return;
                                    }
                                    fs.writeFileSync("tmp/" + foundDevice._id + "/device/resources/kustomization.yaml", 'resources:\n  - resources.yaml\n\ncommonLabels:\n  rciots-managed: "True"');
                                    const command = "oc kustomize tmp/" + foundDevice._id + "/device/resources";
                                    exec(command, (error, stdout, stderr) => {
                                      if (error) {
                                        console.error(`Error executing command: ${error.message}`);
                                        return;
                                      }
                                      if (stderr) {
                                        console.error(`Command stderr: ${stderr}`);
                                        return;
                                      }
                                      zlib.deflate(stdout, (compressErr, compressedData) => {
                                        if (compressErr) {
                                          console.error(`Error compressing output: ${compressErr.message}`);
                                          return;
                                        }
                                        const base64Data = compressedData.toString('base64');
                                        
                                        const metadata = {
                                          v : foundDevice.__v + foundTemplate.__v,
                                          manifest : base64Data
                                        }
                                        fs.writeFile("tmp/" + foundDevice._id + "/metadata.json", JSON.stringify(metadata), (writeErr) => {
                                          if (writeErr) {
                                            console.error(`Error writing metadata to file: ${writeErr.message}`);
                                            return;
                                          }
                                          fs.rm("tmp/" + foundDevice._id + "/base",
                                          { recursive: true, force: true }, (err) => {
                                            if (err) {
                                            return console.log("An error occurred while deleting the directory.", err);
                                            }
                                          });
                                          fs.rm("tmp/" + foundDevice._id + "/device",
                                          { recursive: true, force: true }, (err) => {
                                            if (err) {
                                            return console.log("An error occurred while deleting the directory.", err);
                                            }
                                          });
                                        });
                                        return res.json({ send: true, data: base64Data});
                                      });
                                    });
                                  });
                                } else {
                                  return res.json({ send: false, message: "Empty files to send"});
                                }
                              
                              } catch (errort) {
                                console.error(errort);
                              }
                            })();
                        }
                    });
                }
              });
      } catch (error) {
        console.error(error);
      }
    })();
});
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});