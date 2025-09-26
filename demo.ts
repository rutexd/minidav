import { MemoryFileSystem } from "./src/filesystem/memory-fs";
import { createWebDAVMiddleware } from "./src/server/embeddable";
import express from "express";

const dav = createWebDAVMiddleware({
    filesystem: new MemoryFileSystem(),
    config: {
        logging: {
            enabled: true,
            level: "error",
            requests: true,
            responses: true,
            filesystem: true,
            xml: true,
            locks: true,
            auth: false
        }
    }
});

const app = express()
app.use("/", dav);
app.listen(10050, function(){
    console.log("stared?");
})