import { RGBA, RGBAColours, RGBAUtil } from '../colour';
import { AppConfig } from '../config';
import { LOC } from '../localiser';
import { MaterialType, Mesh } from '../mesh';
import { StatusHandler } from '../status';
import { Triangle, UVTriangle } from '../triangle';
import { UV } from '../util';
import { ASSERT } from '../util/error_util';
import { Vector3 } from '../vector';
import { VoxelMesh } from '../voxel_mesh';
import { VoxeliseParams } from '../worker_types';

export abstract class IVoxeliser {
    public voxelise(mesh: Mesh, voxeliseParams: VoxeliseParams.Input): VoxelMesh {
        const voxelMesh = this._voxelise(mesh, voxeliseParams);

        StatusHandler.info(LOC('voxelise.voxel_count', { count: voxelMesh.getVoxelCount() }));

        const dim = voxelMesh.getBounds().getDimensions().add(1);
        StatusHandler.info(LOC('voxelise.voxel_mesh_dimensions', { x: dim.x, y: dim.y, z: dim.z }));

        return voxelMesh;
    }

    protected abstract _voxelise(mesh: Mesh, voxeliseParams: VoxeliseParams.Input): VoxelMesh;

    /**
     * The rays can pass between the voxels of very small or thin triangles and miss them completely.
     * Call this while the mesh transform is still set: every triangle whose centre has no voxel gets one.
     */
    protected _preserveDetail(mesh: Mesh, voxelMesh: VoxelMesh, voxeliseParams: VoxeliseParams.Input) {
        if (!voxeliseParams.preserveDetail) {
            return;
        }

        for (let triIndex = 0; triIndex < mesh.getTriangleCount(); ++triIndex) {
            const triangle = mesh.getUVTriangle(triIndex);
            const centre = Vector3.add(triangle.v0, triangle.v1).add(triangle.v2).divScalar(3);
            if (voxelMesh.isVoxelAt(centre.copy().round())) {
                continue;
            }

            const colour = this._getVoxelColour(
                mesh,
                triangle,
                mesh.getMaterialByTriangle(triIndex),
                centre,
                voxeliseParams.useMultisampleColouring,
            );
            voxelMesh.addVoxel(centre, colour);
        }
    }

    /**
     * `Location` should be in block-space.
     */
    protected _getVoxelColour(mesh: Mesh, triangle: UVTriangle, materialName: string, location: Vector3, multisample: boolean): RGBA {
        const material = mesh.getMaterialByName(materialName);
        ASSERT(material !== undefined);

        if (material.type === MaterialType.solid) {
            return RGBAUtil.copy(material.colour);
        }

        const samples: RGBA[] = [];
        for (let i = 0; i < (multisample ? AppConfig.Get.MULTISAMPLE_COUNT : 1); ++i) {
            const offset = Vector3.random().sub(0.5);
            samples.push(this._internalGetVoxelColour(
                mesh,
                triangle,
                materialName,
                offset.add(location),
            ));
        }

        return RGBAUtil.average(...samples);
    }

    private _internalGetVoxelColour(mesh: Mesh, triangle: UVTriangle, materialName: string, location: Vector3) {
        const material = mesh.getMaterialByName(materialName);
        ASSERT(material !== undefined && material.type === MaterialType.textured);

        const area01 = new Triangle(triangle.v0, triangle.v1, location).getArea();
        const area12 = new Triangle(triangle.v1, triangle.v2, location).getArea();
        const area20 = new Triangle(triangle.v2, triangle.v0, location).getArea();
        const total = area01 + area12 + area20;

        const w0 = area12 / total;
        const w1 = area20 / total;
        const w2 = area01 / total;

        const uv = new UV(
            triangle.uv0.u * w0 + triangle.uv1.u * w1 + triangle.uv2.u * w2,
            triangle.uv0.v * w0 + triangle.uv1.v * w1 + triangle.uv2.v * w2,
        );

        if (isNaN(uv.u) || isNaN(uv.v)) {
            RGBAUtil.copy(RGBAColours.MAGENTA);
        }

        return mesh.sampleTextureMaterial(materialName, uv);
    }
}
