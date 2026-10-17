jest.mock('../src/js/jagex2/graphics/Canvas', (): {canvas2d: object} => ({canvas2d: {}}));
import PixMap from '../src/js/jagex2/graphics/PixMap';

test('allocates without canvas readback and preserves opaque RGB output', (): void => {
    const data: Uint8ClampedArray = new Uint8ClampedArray(8);
    const createImageData: jest.Mock = jest.fn((): {data: Uint8ClampedArray} => ({data}));
    const getImageData: jest.Mock = jest.fn((): never => {
        throw new Error('readback unavailable');
    });
    const putImageData: jest.Mock = jest.fn();
    const map: PixMap = new PixMap(2, 1, {createImageData, getImageData, putImageData} as unknown as CanvasRenderingContext2D);
    map.pixels[0] = 0x123456;
    map.pixels[1] = 0xffffff;
    map.draw(7, 9);
    expect(createImageData).toHaveBeenCalledWith(2, 1);
    expect(getImageData).not.toHaveBeenCalled();
    expect([...data]).toEqual([0x12, 0x34, 0x56, 255, 255, 255, 255, 255]);
    expect(putImageData).toHaveBeenCalledWith({data}, 7, 9);
});
