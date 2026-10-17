import type Model from './jagex2/graphics/Model';

function smart(bytes: number[], value: number): void {
    if (!Number.isInteger(value) || value < -16384 || value > 16383) throw new Error('Model delta exceeds classic cache format limits.');
    if (value >= -64 && value < 64) bytes.push(value + 64);
    else {
        const encoded: number = value + 49152;
        bytes.push(encoded >>> 8, encoded & 255);
    }
}
function word(bytes: number[], value: number): void {
    bytes.push((value >>> 8) & 255, value & 255);
}

export function encodeModel317(model: Model): Uint8Array {
    if (model.vertexCount > 65535 || model.faceCount > 65535 || model.texturedFaceCount > 255 || !model.faceColor) throw new Error('Model exceeds classic cache format limits.');
    const flags: number[] = [];
    const x: number[] = [],
        y: number[] = [],
        z: number[] = [];
    let previousX: number = 0,
        previousY: number = 0,
        previousZ: number = 0;
    for (let vertex: number = 0; vertex < model.vertexCount; vertex++) {
        const dx: number = model.vertexX[vertex] - previousX;
        const dy: number = model.vertexY[vertex] - previousY;
        const dz: number = model.vertexZ[vertex] - previousZ;
        flags.push((dx ? 1 : 0) | (dy ? 2 : 0) | (dz ? 4 : 0));
        if (dx) smart(x, dx);
        if (dy) smart(y, dy);
        if (dz) smart(z, dz);
        previousX = model.vertexX[vertex];
        previousY = model.vertexY[vertex];
        previousZ = model.vertexZ[vertex];
    }
    const orientations: number[] = [];
    const vertices: number[] = [];
    const colors: number[] = [];
    let last: number = 0;
    for (let face: number = 0; face < model.faceCount; face++) {
        orientations.push(1);
        smart(vertices, model.faceVertexA[face] - last);
        smart(vertices, model.faceVertexB[face] - model.faceVertexA[face]);
        smart(vertices, model.faceVertexC[face] - model.faceVertexB[face]);
        last = model.faceVertexC[face];
        word(colors, model.faceColor[face]);
    }
    const axes: number[] = [];
    for (let texture: number = 0; texture < model.texturedFaceCount; texture++) {
        word(axes, model.texturedVertexA[texture]);
        word(axes, model.texturedVertexB[texture]);
        word(axes, model.texturedVertexC[texture]);
    }
    if ([x.length, y.length, z.length, vertices.length].some((length: number): boolean => length > 65535)) throw new Error('Model stream exceeds classic cache format limits.');
    const footer: number[] = [];
    word(footer, model.vertexCount);
    word(footer, model.faceCount);
    footer.push(model.texturedFaceCount, model.faceInfo ? 1 : 0, model.facePriority ? 255 : model.priority, model.faceAlpha ? 1 : 0, model.faceLabel ? 1 : 0, model.vertexLabel ? 1 : 0);
    word(footer, x.length);
    word(footer, y.length);
    word(footer, z.length);
    word(footer, vertices.length);
    const sections: ArrayLike<number>[] = [flags, orientations, model.facePriority || [], model.faceLabel || [], model.faceInfo || [], model.vertexLabel || [], model.faceAlpha || [], vertices, colors, axes, x, y, z, footer];
    const bytes: Uint8Array = new Uint8Array(sections.reduce((length: number, section: ArrayLike<number>): number => length + section.length, 0));
    let offset: number = 0;
    for (const section of sections) {
        bytes.set(section, offset);
        offset += section.length;
    }
    return bytes;
}
