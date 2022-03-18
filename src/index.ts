import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as path from "path";
import * as child_process from "child_process";
import yaml from "js-yaml";
import ip6addr from "ip6addr";
import * as fs from "fs";

const systemdUnitFilePath = "/etc/systemd/system/bouheki.service";

const DefaultAllowedDomains = [
  "github.com",
  "api.github.com",
  "codeload.github.com",
  "objects.github.com",
  "objects.githubusercontent.com",
  "objects-origin.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "github-registry-files.githubusercontent.com"
];

const bouhekiPath = "/usr/local/bin/bouheki"
const bouhekiConfigPath = path.join(__dirname, "hardening-github-actions.yaml")
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
`

interface BouhekiConfig {
  network: {
    mode: string,
    target: string,
    cidr: {
      allow: Array<string>,
      deny: Array<string>
    },
    domain: {
      allow: Array<string>,
      deny: Array<string>
    }
  },
  files: { enable: boolean },
  mount: { enable: boolean },
  log: {
    format: string,
    output: string
  }
}

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

    const bouhekiConfig: BouhekiConfig = {
      network: {
        mode: config.mode,
        target: config.target,
        cidr: {
          allow: [],
          deny: []
        },
        domain: {
          allow: DefaultAllowedDomains,
          deny: []
        }
      },
      files: { enable: false },
      mount: { enable: false },
      log: {
        format: "json",
        output: "/var/log/bouheki.log.json"
      }
    }

    config.allowed_endpoints.split(",").map(addr => {
      try {
        const cidr: string = ip6addr.createCIDR(addr).toString();
        bouhekiConfig.network.cidr.allow.push(cidr);
      } catch {
        bouhekiConfig.network.domain.allow.push(addr);
      }
    })

    fs.writeFileSync(bouhekiConfigPath, yaml.dump(bouhekiConfig));

    if (!fs.existsSync(bouhekiPath)) {
      const downloadPath: string = await tc.downloadTool("https://github.com/mrtc0/bouheki/releases/download/v0.0.5/bouheki_0.0.5_Linux_x86_64.tar.gz");
      const extractPath = await tc.extractTar(downloadPath);

      let cmd = "sudo",
        args = ["cp", path.join(extractPath, "bouheki"), bouhekiPath];
      child_process.execFileSync(cmd, args);
      child_process.execSync(`sudo chmod +x ${bouhekiPath}`);
    }

    if (!fs.existsSync(systemdUnitFilePath)) {
      fs.writeFileSync(path.join(__dirname, "bouheki.service"), systemdUnitFile);
      let cmd = "sudo",
        args = ["cp", path.join(__dirname, "bouheki.service", systemdUnitFilePath)];
      child_process.execFileSync(cmd, args);
      child_process.execSync("sudo systemctl daemon-reload");
    }

    child_process.execSync("sudo systemctl start bouheki");
  } catch (error:any) {
    core.setFailed(error.message);
  }
})();
