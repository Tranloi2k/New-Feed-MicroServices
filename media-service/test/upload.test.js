import assert from "node:assert/strict";
import test from "node:test";
import { uploadMultipleFiles } from "../src/services/cloudinaryService.js";
import { MAX_FILES, MAX_FILE_SIZE } from "../src/middleware/upload.js";

function file(name, mimetype = "image/jpeg") {
  return { buffer: Buffer.from(name), mimetype, originalname: name };
}

function cloudinaryDouble({ failOn = null } = {}) {
  const deleted = [];
  const upload = async (buffer, options) => {
    const name = buffer.toString();
    if (name === failOn) throw new Error("Cloudinary rejected the file");
    return {
      secure_url: `https://res.cloudinary.com/${name}.jpg`,
      public_id: `newfeed/posts/${name}`,
      resource_type: options.resourceType,
      format: "jpg",
      width: 100,
      height: 100,
    };
  };
  const remove = async (publicId, resourceType) => {
    deleted.push({ publicId, resourceType });
    return { result: "ok" };
  };
  return { upload, remove, deleted };
}

test("limits keep a single request inside the pod memory budget", () => {
  assert.equal(MAX_FILES, 4);
  assert.equal(MAX_FILE_SIZE, 8 * 1024 * 1024);
  // 32MB of buffers is what the 512Mi container is sized for.
  assert.equal((MAX_FILES * MAX_FILE_SIZE) / (1024 * 1024), 32);
});

test("every uploaded file is returned with its Cloudinary identity", async () => {
  const cloudinary = cloudinaryDouble();
  const result = await uploadMultipleFiles(
    [file("one"), file("two")],
    { folder: "newfeed/posts" },
    cloudinary
  );

  assert.equal(result.length, 2);
  assert.equal(result[0].url, "https://res.cloudinary.com/one.jpg");
  assert.equal(result[0].publicId, "newfeed/posts/one");
  assert.deepEqual(cloudinary.deleted, [], "nothing is deleted on success");
});

test("videos are uploaded as video, images as image", async () => {
  const cloudinary = cloudinaryDouble();
  const result = await uploadMultipleFiles(
    [file("clip", "video/mp4"), file("photo", "image/png")],
    {},
    cloudinary
  );

  assert.equal(result[0].resourceType, "video");
  assert.equal(result[1].resourceType, "image");
});

test("a partial failure deletes the files that already landed", async () => {
  const cloudinary = cloudinaryDouble({ failOn: "three" });

  await assert.rejects(
    () => uploadMultipleFiles([file("one"), file("two"), file("three")], {}, cloudinary),
    /Cloudinary rejected the file/
  );

  assert.deepEqual(
    cloudinary.deleted.map(({ publicId }) => publicId).sort(),
    ["newfeed/posts/one", "newfeed/posts/two"],
    "no orphan may be left behind on Cloudinary"
  );
});

test("a failed cleanup does not mask the upload error", async () => {
  const cloudinary = cloudinaryDouble({ failOn: "bad" });
  cloudinary.remove = async () => {
    throw new Error("delete unavailable");
  };

  await assert.rejects(
    () => uploadMultipleFiles([file("good"), file("bad")], {}, cloudinary),
    /Cloudinary rejected the file/
  );
});
