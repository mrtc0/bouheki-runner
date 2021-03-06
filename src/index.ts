import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as path from "path";
import * as child_process from "child_process";
import * as fs from "fs";
import { BouhekiConfigBuilder } from "./bouheki";

const bouhekiPath = "/usr/local/bin/bouheki";
const bouhekiConfigPath = path.join(__dirname, "hardening-github-actions.yaml");
const systemdUnitFile = `[Unit]
Description=bouheki
After=network.target

[Service]
Type=simple
User=root
Group=root
ExecStart=${bouhekiPath} --config ${bouhekiConfigPath}
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
`;

const systemdUnitFilePath = "/etc/systemd/system/bouheki.service";

(async () => {
  try {
    if (process.platform !== "linux") {
      core.setFailed("This action only runs on Linux.");
      return;
    }

    if (core.getInput("service_action") === "stop") {
      child_process.execSync("sudo systemctl stop bouheki");
      return;
    }

    const config = {
      allowed_endpoints: core.getInput("allowed-endpoints"),
      mode: core.getInput("mode"),
      target: core.getInput("target"),
    };

    if (config.mode !== "block" && config.mode !== "monitor") {
      core.setFailed("mode must be either 'block' or 'monitor'");
    }

    if (config.target !== "container" && config.target !== "host") {
      core.setFailed("target must be either 'container' or 'host'");
    }

    const builder = new BouhekiConfigBuilder().allowedAddresses(
      config.allowed_endpoints
    );
    builder.writeConfig(bouhekiConfigPath);

    const downloadPath: string = await tc.downloadTool(
      "https://github.com/mrtc0/bouheki/releases/download/v0.0.5/bouheki_0.0.5_Linux_x86_64.tar.gz"
    );
    const extractPath = await tc.extractTar(downloadPath);

    let cmd = "sudo",
      args = ["cp", path.join(extractPath, "bouheki"), bouhekiPath];
    child_process.execFileSync(cmd, args);
    child_process.execSync(`sudo chmod +x ${bouhekiPath}`);

    fs.writeFileSync(path.join(__dirname, "bouheki.service"), systemdUnitFile);
    (cmd = "sudo"),
      (args = [
        "cp",
        path.join(__dirname, "bouheki.service"),
        systemdUnitFilePath,
      ]);
    child_process.execFileSync(cmd, args);
    child_process.execSync("sudo systemctl daemon-reload");

    child_process.execSync("sudo systemctl start bouheki");
  } catch (error: any) {
    core.setFailed(error.message);
  }
})();
