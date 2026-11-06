import { Bounds } from './bounds';
import { RGBA } from './colour';
import { LOC } from './localiser';
import { degreesToRadians } from './math';
import { AppError } from './util/error_util';
import { Vector3 } from './vector';
import { VoxelMesh } from './voxel_mesh';
import { VoxeliseParams } from './worker_types';

// Splats this transparent are mostly haze around the model, they are skipped
const MIN_OPACITY = 0.15;

// Colour of the zeroth spherical harmonic band, used by the Gaussian Splatting .ply format
const SH_C0 = 0.28209479177387814;

/**
 * Coloured points, read from a Gaussian Splatting file (.splat, or a .ply written by 3DGS tools).
 * Every point becomes a voxel, there are no triangles.
 */
export class PointCloud {
    public positions: Float32Array; // x, y, z per point
    public colours: Float32Array; // r, g, b per point, 0 to 1

    private constructor(positions: Float32Array, colours: Float32Array) {
        this.positions = positions;
        this.colours = colours;
    }

    public static isPointCloudFile(fileName: string) {
        return /\.(splat|ply)$/i.test(fileName);
    }

    public static async load(file: File): Promise<PointCloud> {
        const buffer = await file.arrayBuffer();
        const cloud = /\.splat$/i.test(file.name) ? PointCloud._fromSplat(buffer) : PointCloud._fromPly(buffer);
        if (cloud.getCount() === 0) {
            throw new AppError(LOC('import.no_vertices_loaded'));
        }
        return cloud;
    }

    public getCount() {
        return this.positions.length / 3;
    }

    /**
     * The .splat layout: 32 bytes per splat, position (3 floats), scale (3 floats),
     * colour and opacity (4 bytes), rotation (4 bytes).
     */
    private static _fromSplat(buffer: ArrayBuffer): PointCloud {
        const count = Math.floor(buffer.byteLength / 32);
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);
        const positions: number[] = [];
        const colours: number[] = [];
        for (let i = 0; i < count; ++i) {
            const base = i * 32;
            if (bytes[base + 27] / 255 < MIN_OPACITY) {
                continue;
            }
            positions.push(view.getFloat32(base, true), view.getFloat32(base + 4, true), view.getFloat32(base + 8, true));
            colours.push(bytes[base + 24] / 255, bytes[base + 25] / 255, bytes[base + 26] / 255);
        }
        return new PointCloud(new Float32Array(positions), new Float32Array(colours));
    }

    private static _fromPly(buffer: ArrayBuffer): PointCloud {
        const bytes = new Uint8Array(buffer);
        const headerEnd = PointCloud._findHeaderEnd(bytes);
        const header = new TextDecoder().decode(bytes.subarray(0, headerEnd)).split(/\r?\n/);

        const format = header.find((line) => line.startsWith('format'))?.split(/\s+/)[1];
        type Property = { name: string, type: string };
        const elements: { name: string, count: number, properties: Property[] }[] = [];
        for (const line of header) {
            const parts = line.trim().split(/\s+/);
            if (parts[0] === 'element') {
                elements.push({ name: parts[1], count: parseInt(parts[2]), properties: [] });
            } else if (parts[0] === 'property' && elements.length > 0) {
                if (parts[1] === 'list') {
                    elements[elements.length - 1].properties.push({ name: parts[4], type: 'list' });
                } else {
                    elements[elements.length - 1].properties.push({ name: parts[2], type: parts[1] });
                }
            }
        }

        const vertexElement = elements.find((element) => element.name === 'vertex');
        if (vertexElement === undefined || elements[0] !== vertexElement) {
            throw new AppError(LOC('import.unsupported_ply'));
        }
        if (elements.some((element) => element.name === 'face' && element.count > 0)) {
            throw new AppError(LOC('import.unsupported_ply'));
        }

        const names = vertexElement.properties.map((property) => property.name);
        const index = (name: string) => names.indexOf(name);
        const ix = index('x');
        const iy = index('y');
        const iz = index('z');
        const iDc = [index('f_dc_0'), index('f_dc_1'), index('f_dc_2')];
        const iRgb = [index('red'), index('green'), index('blue')];
        const iOpacity = index('opacity');
        const iAlpha = index('alpha');

        // Read every vertex into an array of numbers, in property order
        const values = new Float64Array(names.length);
        let readVertex: (vertex: number) => void;
        if (format === 'ascii') {
            const lines = new TextDecoder().decode(bytes.subarray(headerEnd)).split(/\r?\n/).filter((line) => line.trim().length > 0);
            readVertex = (vertex) => {
                const parts = lines[vertex].trim().split(/\s+/);
                for (let i = 0; i < names.length; ++i) {
                    values[i] = parseFloat(parts[i]);
                }
            };
        } else if (format === 'binary_little_endian' || format === 'binary_big_endian') {
            const littleEndian = format === 'binary_little_endian';
            const view = new DataView(buffer, headerEnd);
            const sizes: { [type: string]: number } = {
                char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2,
                int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8,
            };
            const types = vertexElement.properties.map((property) => property.type);
            if (types.some((type) => sizes[type] === undefined)) {
                throw new AppError(LOC('import.unsupported_ply'));
            }
            const stride = types.reduce((sum, type) => sum + sizes[type], 0);
            readVertex = (vertex) => {
                let offset = vertex * stride;
                for (let i = 0; i < types.length; ++i) {
                    switch (types[i]) {
                        case 'char': case 'int8': values[i] = view.getInt8(offset); break;
                        case 'uchar': case 'uint8': values[i] = view.getUint8(offset); break;
                        case 'short': case 'int16': values[i] = view.getInt16(offset, littleEndian); break;
                        case 'ushort': case 'uint16': values[i] = view.getUint16(offset, littleEndian); break;
                        case 'int': case 'int32': values[i] = view.getInt32(offset, littleEndian); break;
                        case 'uint': case 'uint32': values[i] = view.getUint32(offset, littleEndian); break;
                        case 'float': case 'float32': values[i] = view.getFloat32(offset, littleEndian); break;
                        default: values[i] = view.getFloat64(offset, littleEndian); break;
                    }
                    offset += sizes[types[i]];
                }
            };
        } else {
            throw new AppError(LOC('import.unsupported_ply'));
        }

        const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
        const positions: number[] = [];
        const colours: number[] = [];
        for (let vertex = 0; vertex < vertexElement.count; ++vertex) {
            readVertex(vertex);

            // 3DGS stores opacity before a sigmoid, plain point clouds an alpha byte
            const opacity = iOpacity >= 0 ? 1 / (1 + Math.exp(-values[iOpacity])) : (iAlpha >= 0 ? values[iAlpha] / 255 : 1);
            if (opacity < MIN_OPACITY) {
                continue;
            }

            positions.push(values[ix], values[iy], values[iz]);
            if (iDc.every((i) => i >= 0)) {
                colours.push(...iDc.map((i) => clamp01(0.5 + SH_C0 * values[i])));
            } else if (iRgb.every((i) => i >= 0)) {
                colours.push(...iRgb.map((i) => clamp01(values[i] / 255)));
            } else {
                colours.push(1, 1, 1);
            }
        }
        return new PointCloud(new Float32Array(positions), new Float32Array(colours));
    }

    private static _findHeaderEnd(bytes: Uint8Array) {
        const marker = 'end_header';
        const limit = Math.min(bytes.length, 64 * 1024);
        for (let i = 0; i < limit - marker.length; ++i) {
            let matches = true;
            for (let j = 0; j < marker.length && matches; ++j) {
                matches = bytes[i + j] === marker.charCodeAt(j);
            }
            if (matches) {
                let end = i + marker.length;
                if (bytes[end] === 13) {
                    ++end; // \r
                }
                return end + 1; // \n
            }
        }
        throw new AppError(LOC('import.unsupported_ply'));
    }

    /**
     * Same transforms a mesh gets on import: up axis, rotation, centred and scaled to a height of 1.
     */
    public process(upAxis: 'y' | 'z' | '-z', pitch: number, roll: number, yaw: number) {
        const p = this.positions;
        if (upAxis !== 'y') {
            const sign = upAxis === '-z' ? -1 : 1;
            for (let i = 0; i < p.length; i += 3) {
                const y = p[i + 1];
                p[i + 1] = sign * p[i + 2];
                p[i + 2] = -sign * y;
            }
        }

        const cosa = Math.cos(yaw * degreesToRadians);
        const sina = Math.sin(yaw * degreesToRadians);
        const cosb = Math.cos(pitch * degreesToRadians);
        const sinb = Math.sin(pitch * degreesToRadians);
        const cosc = Math.cos(roll * degreesToRadians);
        const sinc = Math.sin(roll * degreesToRadians);
        for (let i = 0; i < p.length; i += 3) {
            const x = p[i];
            const y = p[i + 1];
            const z = p[i + 2];
            p[i] = cosa * cosb * x + (cosa * sinb * sinc - sina * cosc) * y + (cosa * sinb * cosc + sina * sinc) * z;
            p[i + 1] = sina * cosb * x + (sina * sinb * sinc + cosa * cosc) * y + (sina * sinb * cosc - cosa * sinc) * z;
            p[i + 2] = -sinb * x + cosb * sinc * y + cosb * cosc * z;
        }

        const bounds = this.getBounds();
        const centre = bounds.getCentre();
        const height = bounds.max.y - bounds.min.y;
        if (!(height > 0) || !isFinite(height)) {
            throw new AppError(LOC('import.could_not_scale_mesh'));
        }
        for (let i = 0; i < p.length; i += 3) {
            p[i] = (p[i] - centre.x) / height;
            p[i + 1] = (p[i + 1] - centre.y) / height;
            p[i + 2] = (p[i + 2] - centre.z) / height;
        }
    }

    public getBounds() {
        const bounds = Bounds.getInfiniteBounds();
        const point = new Vector3(0, 0, 0);
        for (let i = 0; i < this.positions.length; i += 3) {
            point.x = this.positions[i];
            point.y = this.positions[i + 1];
            point.z = this.positions[i + 2];
            bounds.extendByPoint(point);
        }
        return bounds;
    }

    /**
     * Puts every point in the voxel it falls in, overlapping points are blended.
     */
    public voxelise(params: VoxeliseParams.Input): VoxelMesh {
        const voxelMesh = new VoxelMesh(params);
        const dimensions = this.getBounds().getDimensions();
        const axisSize = dimensions[params.constraintAxis];
        const scale = (params.size - 1) / axisSize;
        const offset = new Vector3(0, 0, 0);
        offset[params.constraintAxis] = params.size % 2 === 0 ? 0.5 : 0.0;

        const position = new Vector3(0, 0, 0);
        for (let i = 0; i < this.getCount(); ++i) {
            position.x = this.positions[i * 3] * scale + offset.x;
            position.y = this.positions[i * 3 + 1] * scale + offset.y;
            position.z = this.positions[i * 3 + 2] * scale + offset.z;
            const colour: RGBA = { r: this.colours[i * 3], g: this.colours[i * 3 + 1], b: this.colours[i * 3 + 2], a: 1.0 };
            voxelMesh.addVoxel(position, colour);
        }
        return voxelMesh;
    }

    /**
     * Closes holes up to about twice `radius` voxels wide in the surface (a morphological closing:
     * grow every voxel by `radius`, then shrink back). Only empty spots that end up enclosed are
     * filled, the surface does not get thicker. New voxels take the average colour around them.
     */
    public static fillHoles(voxelMesh: VoxelMesh, radius: number) {
        if (radius <= 0) {
            return;
        }

        const offsets: [number, number, number][] = [];
        for (let x = -radius; x <= radius; ++x) {
            for (let y = -radius; y <= radius; ++y) {
                for (let z = -radius; z <= radius; ++z) {
                    offsets.push([x, y, z]);
                }
            }
        }
        const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

        const voxels = voxelMesh.getVoxels();
        const grown = new Set<string>();
        for (const voxel of voxels) {
            const p = voxel.position;
            for (const [x, y, z] of offsets) {
                grown.add(key(p.x + x, p.y + y, p.z + z));
            }
        }

        const toFill: Vector3[] = [];
        grown.forEach((k) => {
            const [px, py, pz] = k.split(',').map(Number);
            const position = new Vector3(px, py, pz);
            if (voxelMesh.isVoxelAt(position)) {
                return;
            }
            // Survives the shrink only if everything around it was covered, i.e. it sits inside a gap
            if (offsets.every(([x, y, z]) => grown.has(key(px + x, py + y, pz + z)))) {
                toFill.push(position);
            }
        });

        // Colours come from the original voxels only, so work them all out before adding any
        const near = new Vector3(0, 0, 0);
        const fills = toFill.map((position) => {
            const colour: RGBA = { r: 0, g: 0, b: 0, a: 1.0 };
            let count = 0;
            for (const [x, y, z] of offsets) {
                near.x = position.x + x;
                near.y = position.y + y;
                near.z = position.z + z;
                const voxel = voxelMesh.getVoxelAt(near);
                if (voxel !== undefined) {
                    colour.r += voxel.colour.r;
                    colour.g += voxel.colour.g;
                    colour.b += voxel.colour.b;
                    ++count;
                }
            }
            colour.r /= count;
            colour.g /= count;
            colour.b /= count;
            return { position, colour };
        });
        fills.forEach((fill) => voxelMesh.addVoxel(fill.position, fill.colour));
    }
}
